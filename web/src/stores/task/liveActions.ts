// 流式增量缓冲(批次 R4):delta 事件就地追加,llm_call 落库事件到达时清对应 key。
// 语义要点(原实现注释保留):delta 是暂态展示,权威数据以 task_llm_calls 落库行为准;
// 整表替换(而非原地 set)保持引用语义,消费方 computed 依赖即刷新。
import type * as api from '../../api';
import type { LiveActions, TaskState } from './taskContext';

export function createLiveActions(state: TaskState): LiveActions {
  /** delta 缓冲 key(与后端 phase/step_index 透出契约一致;缺 phase 的事件不入缓冲) */
  function liveKey(phase: string, stepIndex?: number): string {
    return `${phase}:${stepIndex ?? ''}`;
  }

  /** 追加一条 delta 增量(仅当前任务;detail/phase 缺失视为旧服务端事件,忽略) */
  function appendLiveDelta(ev: api.TaskEvent): void {
    if (ev.task_id !== state.currentTaskId.value || !ev.detail || !ev.phase) return;
    const key = liveKey(ev.phase, ev.step_index);
    const next = new Map(state.liveBuffers.value);
    next.set(key, (next.get(key) ?? '') + ev.detail);
    state.liveBuffers.value = next;
  }

  /** 清某次调用的流式缓冲(llm_call 落库事件到达 = 该调用已有权威行) */
  function clearLiveDelta(phase: string, stepIndex?: number): void {
    const key = liveKey(phase, stepIndex);
    if (!state.liveBuffers.value.has(key)) return;
    const next = new Map(state.liveBuffers.value);
    next.delete(key);
    state.liveBuffers.value = next;
  }

  /** 清空全部流式缓冲(切任务/删除任务/任务终态让位) */
  function clearAllLiveDeltas(): void {
    if (state.liveBuffers.value.size === 0) return;
    state.liveBuffers.value = new Map();
  }

  return { liveKey, appendLiveDelta, clearLiveDelta, clearAllLiveDeltas };
}
