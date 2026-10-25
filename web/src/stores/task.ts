// 任务模式 store:顶层模式(roleplay/task)切换与持久化、任务列表/详情、
// 任务事件 SSE 订阅(WP5:取代原 1s REST 轮询与本地合成伪事件)。
// 从 store.ts 按领域拆分。依赖方向(M5 断环后):本 store 是依赖图汇点——
//   - appMode 是本 store 状态;genSettings 顶层 import 本 store 直读(loadSettings/
//     saveSettings 取覆盖层用),该边单向、不构成环,故未设 appMode 桥;
//   - 对 chat/genSettings/uiPrefs 的三处能力(事件上报 / 设置重载 / 界面偏好)
//     经回调桥(storeBridge.ts)调用。
//   整图因此无环(见 tools/check-arch.mjs)。
//
// 2026-10-25 再拆一层(与 stores/chat/ 同构):store 体 521 行 → 本文件只做装配,
// 实现分散在 task/ 下的 state(状态)、runtime(签名与定时器)、liveActions(流式缓冲)、
// loadActions(列表/详情/选择)、eventActions(SSE 与重连)、crudActions(增删改查)、
// modeActions(模式切换与持久化)。动作模块之间不静态 import,跨模块调用走 deps.actions。
import { defineStore } from 'pinia';
import { watch } from 'vue';
import { createCrudActions } from './task/crudActions';
import { createEventActions } from './task/eventActions';
import { createLiveActions } from './task/liveActions';
import { createLoadActions } from './task/loadActions';
import { createModeActions } from './task/modeActions';
import { createTaskRuntime } from './task/runtime';
import { createTaskState } from './task/state';
import type { TaskActions, TaskDeps } from './task/taskContext';

export const useTaskStore = defineStore('app.task', () => {
  const state = createTaskState();
  // 动作表先建空壳,再把各模块的返回值合并进来:模块之间需要互相调用,
  // 静态 import 会形成环,故用「装配后回填」的延迟解析(与 stores/chat/ 同一手法)。
  const actions = {} as TaskActions;
  const deps: TaskDeps = { runtime: createTaskRuntime(), actions };

  Object.assign(
    actions,
    createLiveActions(state),
    createLoadActions(state, deps),
    createEventActions(state, deps),
    createCrudActions(state, deps),
    createModeActions(state, deps),
  );

  // 新建任务模式变化即持久化(原实现在 store 体内 watch;此处改用动作表里的写入函数)
  watch(state.taskRunMode, () => actions.persistTaskRunMode());

  return {
    ...state,
    setAppMode: actions.setAppMode,
    loadTasks: actions.loadTasks,
    loadGlobalTaskUsage: actions.loadGlobalTaskUsage,
    loadTaskCalls: actions.loadTaskCalls,
    createTask: actions.createTask,
    selectTask: actions.selectTask,
    clearSelectedTask: actions.clearSelectedTask,
    restoreSelectedTask: actions.restoreSelectedTask,
    loadTaskDetail: actions.loadTaskDetail,
    runTask: actions.runTask,
    stopTask: actions.stopTask,
    approveTask: actions.approveTask,
    followupTask: actions.followupTask,
    planChatTask: actions.planChatTask,
    deleteTask: actions.deleteTask,
    startTaskEvents: actions.startTaskEvents,
    stopTaskEvents: actions.stopTaskEvents,
    startTaskPolling: actions.startTaskPolling,
    stopTaskPolling: actions.stopTaskPolling,
  };
});
