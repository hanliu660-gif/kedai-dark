// 任务 store 的响应式状态:唯一定义处。
// 各动作模块拿到同一份引用,不在模块内自建 ref(否则会出现两份互不同步的状态)。
import { ref } from 'vue';
import type * as api from '../../api';
import type { TaskState } from './taskContext';
import { readStoredAppMode, readStoredTaskRunMode } from './runtime';

export function createTaskState(): TaskState {
  return {
    /** 顶层模式:roleplay = 角色扮演,task = 任务工作台;持久化到 localStorage */
    appMode: ref<'roleplay' | 'task'>(readStoredAppMode()),
    /** 新建任务的执行模式(批次 4 六模式;持久化到 localStorage,写时经 watch) */
    taskRunMode: ref<api.TaskRunMode>(readStoredTaskRunMode()),
    tasks: ref<api.TaskRecord[]>([]),
    currentTaskId: ref<string | null>(null),
    /** 当前任务详情(含子任务) */
    currentTask: ref<api.TaskDetail | null>(null),
    /** 当前任务 token 累计(由详情带出的 usage_total;任务模式统计块数据源) */
    currentTaskUsage: ref<api.TaskUsageTotal | null>(null),
    /** 全部任务 token 累计(任务模式「全局累计」) */
    globalTaskUsage: ref<api.TaskUsageTotal | null>(null),
    /** 当前任务 LLM 调用记录(批次 3 L3 调用追踪面板;GET /api/tasks/{id}/calls) */
    taskCalls: ref<api.TaskLlmCall[]>([]),
    /**
     * 流式增量缓冲(批次 R4 任务模式流式输出):key = `${phase}:${step_index ?? ''}`,
     * 值为该调用已攒的正文增量。**delta 事件就地追加进本 Map,绝不走 contentSignature
     * 全量重拉链**(每 token 全量拉取 + stringify 不可行;delta 已由后端攒批节流)。
     * 对齐口径:llm_call 落库事件到达时清对应 key——delta 是暂态展示,权威数据以
     * task_llm_calls 落库行(loadTaskCalls 全量重拉)为准;切任务/删除任务全清。
     * 整表替换(而非原地 set)保持引用语义与既有状态一致,消费方 computed 依赖即刷新。
     */
    liveBuffers: ref(new Map<string, string>()),
  };
}
