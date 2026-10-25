// 任务 CRUD:本地乐观更新保留;状态变化由 SSE 事件驱动后续刷新,不再合成伪事件。
import * as api from '../../api';
import { uiPrefsBridge } from '../storeBridge';
import type { CrudActions, TaskDeps, TaskState } from './taskContext';
import { contentSignature, persistCurrentTaskId } from './runtime';

export function createCrudActions(state: TaskState, deps: TaskDeps): CrudActions {
  const { runtime, actions } = deps;

  async function createTask(title: string, characterId?: string): Promise<api.TaskRecord> {
    const task = await api.createTask(title, characterId, state.taskRunMode.value);
    state.tasks.value = [task, ...state.tasks.value];
    // 本地乐观改写后同步签名(下次事件刷新同内容时不再替换)
    runtime.listSignature = contentSignature(state.tasks.value);
    await actions.selectTask(task.id);
    return task;
  }

  async function runTask(id: string): Promise<void> {
    await api.runTask(id);
    // 任务开始执行时自动展开一次 Agent 面板(进度可见性);用户若已主动收起则不打扰
    uiPrefsBridge().autoOpenAgentPanel();
    await actions.loadTaskDetail(id);
  }

  async function stopTask(id: string): Promise<void> {
    await api.stopTask(id);
    await actions.loadTaskDetail(id);
  }

  /** 批准计划(plan 模式):plan 可选(修改后批准);成功后刷新该任务详情 */
  async function approveTask(id: string, plan?: api.TaskStep[]): Promise<void> {
    await api.approveTask(id, plan);
    // 批准后任务进入执行:同样自动展开一次
    uiPrefsBridge().autoOpenAgentPanel();
    await actions.loadTaskDetail(id);
  }

  /** 终态追加指令(批次 R2a;R2b+ 扩 mode):仅终态可调用(后端门禁 409);
   *  mode=append(缺省)追加进 result,mode=replace 整体替换(段标「修订 N」);
   *  成功后刷新详情(messages 指令历史 + result 随详情带出) */
  async function followupTask(
    id: string,
    content: string,
    mode: 'append' | 'replace' = 'append',
  ): Promise<void> {
    await api.followupTask(id, content, mode);
    await actions.loadTaskDetail(id);
  }

  /** 批准环节规划对话(批次 R2b):仅 planned 态;同步等待修订完成,
   *  成功后刷新详情(修订计划 + plan_chat 对话记录随详情带出) */
  async function planChatTask(id: string, message: string): Promise<void> {
    await api.planChatTask(id, message);
    await actions.loadTaskDetail(id);
  }

  async function deleteTask(id: string): Promise<void> {
    await api.deleteTask(id);
    state.tasks.value = state.tasks.value.filter((t) => t.id !== id);
    runtime.listSignature = contentSignature(state.tasks.value); // 同步签名(同上)
    if (state.currentTaskId.value === id) {
      state.currentTaskId.value = null;
      state.currentTask.value = null;
      state.currentTaskUsage.value = null;
      state.taskCalls.value = [];
      runtime.callsSignature = contentSignature([]);
      actions.clearAllLiveDeltas(); // 批次 R4:任务删除,其流式缓冲一并失效
      persistCurrentTaskId(null); // 实跑问题 4:删除当前任务时同步清持久化选择
    }
  }

  return { createTask, runTask, stopTask, approveTask, followupTask, planChatTask, deleteTask };
}
