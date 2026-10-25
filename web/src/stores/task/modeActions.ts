// 顶层模式(roleplay/task)切换与两条持久化写入。
// 进任务模式 = 加载任务列表 + 恢复上次选中 + 载全局累计 + 收 Agent 面板 + 起 SSE;
// 退出 = 停 SSE(含重连/兜底轮询定时器)。设置重载与模式持久化两条与模式无关,每次都做。
import { reloadSettings, uiPrefsBridge } from '../storeBridge';
import type { ModeActions, TaskDeps, TaskState } from './taskContext';
import { APP_MODE_KEY, TASK_RUN_MODE_KEY } from './runtime';

export function createModeActions(state: TaskState, deps: TaskDeps): ModeActions {
  const { actions } = deps;

  function persistAppMode(): void {
    try {
      localStorage.setItem(APP_MODE_KEY, state.appMode.value);
    } catch {
      /* 忽略 */
    }
  }

  /** 持久化新建任务模式(仿 persistAppMode:try/catch 容错,写失败静默) */
  function persistTaskRunMode(): void {
    try {
      localStorage.setItem(TASK_RUN_MODE_KEY, state.taskRunMode.value);
    } catch {
      /* 忽略 */
    }
  }

  /** 切换顶层模式;进入任务模式时加载任务并启动 SSE 订阅,退出时停止订阅与兜底轮询 */
  function setAppMode(mode: 'roleplay' | 'task'): void {
    state.appMode.value = mode;
    if (mode === 'task') {
      void actions.loadTasks().then(() => actions.restoreSelectedTask());
      void actions.loadGlobalTaskUsage();
      uiPrefsBridge().collapseAgentPanel();
      actions.startTaskEvents();
    } else {
      actions.stopTaskEvents();
    }
    reloadSettings();
    persistAppMode();
  }

  return { setAppMode, persistAppMode, persistTaskRunMode };
}
