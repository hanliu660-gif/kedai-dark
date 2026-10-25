// 任务列表 / 详情 / 调用记录的加载,以及「选中-恢复-清空」流程。
// 三道防线(原实现,别拆):① in-flight 合并把事件风暴压成一次请求 + 一次补发;
// ② 内容签名去重让未变的响应保持原引用(面板零重渲染);③ 切任务时重置签名,防新任务被旧签名误去重。
import * as api from '../../api';
import type { LoadActions, TaskDeps, TaskState } from './taskContext';
import { contentSignature, persistCurrentTaskId, readStoredCurrentTaskId } from './runtime';

export function createLoadActions(state: TaskState, deps: TaskDeps): LoadActions {
  const { runtime, actions } = deps;

  /**
   * 事件驱动刷新的内容签名(非响应式;multi/team 模式 agent_status/usage 事件高频,
   * 签名一致说明数据未变,跳过整体替换——引用不变则依赖该状态的 TaskBoard/AgentPanel/Sidebar
   * 零重渲染,避免「每次 SSE 事件 → 全量 patch + markdown 重跑」的卡顿链)。
   */
  const { detailInflight } = runtime;

  /** 任务列表刷新:in-flight 期间的重复调用合并为结束后补一次(SSE 事件密集时不打爆接口) */
  async function loadTasks(): Promise<void> {
    if (runtime.tasksInflight) {
      runtime.tasksPending = true;
      return;
    }
    runtime.tasksInflight = true;
    try {
      do {
        runtime.tasksPending = false;
        try {
          const list = await api.listTasks();
          // 内容签名去重:列表未变时保持原引用(侧栏任务列表零重渲染)
          const sig = contentSignature(list);
          if (sig !== runtime.listSignature) {
            runtime.listSignature = sig;
            state.tasks.value = list;
          }
        } catch (e) {
          console.error('加载任务列表失败', e);
        }
      } while (runtime.tasksPending);
    } finally {
      runtime.tasksInflight = false;
    }
  }

  /** 全局 token 累计刷新:同款 in-flight 合并(usage 事件高频) */
  async function loadGlobalTaskUsage(): Promise<void> {
    if (runtime.usageTotalInflight) {
      runtime.usageTotalPending = true;
      return;
    }
    runtime.usageTotalInflight = true;
    try {
      do {
        runtime.usageTotalPending = false;
        try {
          state.globalTaskUsage.value = await api.getTaskUsageTotal();
        } catch (e) {
          console.error('加载任务 token 累计失败', e);
        }
      } while (runtime.usageTotalPending);
    } finally {
      runtime.usageTotalInflight = false;
    }
  }

  /** 任务详情刷新:按 task_id 的 in-flight 合并——同 id 请求进行中时,事件驱动的
   *  重复刷新只记录一次「待重放」意图,请求结束后补发一次,不叠加并发请求;
   *  响应与现状签名一致时跳过赋值(数据未变,引用保持,面板零重渲染) */
  async function loadTaskDetail(id: string): Promise<void> {
    if (detailInflight.has(id)) {
      detailInflight.set(id, true);
      return;
    }
    detailInflight.set(id, false);
    try {
      do {
        detailInflight.set(id, false);
        try {
          const detail = await api.getTask(id);
          const sig = contentSignature(detail);
          // id 检查兜底:切任务后旧签名残留时,即便内容碰巧相同也必须替换(现状是别的任务/null)
          if (sig !== runtime.detailSignature || state.currentTask.value?.task.id !== id) {
            runtime.detailSignature = sig;
            state.currentTask.value = detail;
            state.currentTaskUsage.value = detail.usage_total ?? null;
          }
        } catch (e) {
          console.error('加载任务详情失败', e);
          break;
        }
      } while (detailInflight.get(id));
    } finally {
      detailInflight.delete(id);
    }
  }

  /** 调用追踪记录刷新:失败静默(保持旧值),「调用情况」tab 激活时由 llm_call 事件驱动;
   *  同款内容签名去重(multi/team 并行调用落库事件密集,记录未变时保持引用,面板零重渲染) */
  async function loadTaskCalls(taskId: string): Promise<void> {
    try {
      const calls = await api.getTaskCalls(taskId);
      const sig = contentSignature(calls);
      if (sig !== runtime.callsSignature) {
        runtime.callsSignature = sig;
        state.taskCalls.value = calls;
      }
    } catch {
      // 静默:调用追踪是辅助面板,失败不影响主流程
    }
  }

  async function selectTask(id: string): Promise<void> {
    state.currentTaskId.value = id;
    persistCurrentTaskId(id);
    // 切换任务时清空旧任务的调用记录(「调用情况」tab 由 watch/事件重新加载)
    // 与流式缓冲(批次 R4:旧任务的 delta 不带入新任务);
    // 同步重置内容签名,防止新任务首屏记录与旧任务签名碰巧相同而被去重跳过
    state.taskCalls.value = [];
    runtime.callsSignature = contentSignature([]);
    actions.clearAllLiveDeltas();
    await loadTaskDetail(id);
  }

  /** 清空当前任务选择(任务被删除/列表已无该 id 时;同步清持久化) */
  function clearSelectedTask(): void {
    state.currentTaskId.value = null;
    state.currentTask.value = null;
    state.currentTaskUsage.value = null;
    state.taskCalls.value = [];
    actions.clearAllLiveDeltas();
    persistCurrentTaskId(null);
  }

  /**
   * 恢复上次选中的任务(实跑问题 4):重启后 currentTaskId 若仍是内存态,
   * Agent 面板与调用记录将无入口加载,用户感知为「记录丢失」。
   * 在任务列表加载完成后调用:仅当持久化的 id 仍在列表中才恢复,
   * 否则清空(任务已被删除时不留下悬空选择)。
   */
  async function restoreSelectedTask(): Promise<void> {
    if (state.currentTaskId.value) return; // 已有选择(会话内切换路径)不覆盖
    const saved = readStoredCurrentTaskId();
    if (!saved) return;
    if (!state.tasks.value.some((t) => t.id === saved)) {
      persistCurrentTaskId(null);
      return;
    }
    await selectTask(saved);
    await loadTaskCalls(saved);
  }

  return {
    loadTasks,
    loadGlobalTaskUsage,
    loadTaskDetail,
    loadTaskCalls,
    selectTask,
    clearSelectedTask,
    restoreSelectedTask,
  };
}
