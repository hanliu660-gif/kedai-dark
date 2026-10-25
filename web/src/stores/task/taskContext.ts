// 任务 store 的行动模块契约:状态 / 内部运行时 / 各动作模块签名。
// 拆分目的:原 task.ts(594 行、store 体 521 行)按「状态 / 流式缓冲 / 加载 / 事件订阅 / CRUD / 模式」
// 切成 6 个动作模块,store 本体只留装配。依赖方向仍是单向:动作模块之间不静态 import,
// 跨模块调用一律走 deps.actions(装配时回填),避免出现新的 import 环。
import type { Ref } from 'vue';
import type * as api from '../../api';

/** 响应式状态(唯一定义处;各动作模块只读引用、不自建 ref) */
export interface TaskState {
  /** 顶层模式:roleplay = 角色扮演,task = 任务工作台(持久化到 localStorage) */
  appMode: Ref<'roleplay' | 'task'>;
  /** 新建任务的执行模式(批次 4 六模式;持久化到 localStorage) */
  taskRunMode: Ref<api.TaskRunMode>;
  tasks: Ref<api.TaskRecord[]>;
  currentTaskId: Ref<string | null>;
  /** 当前任务详情(含子任务) */
  currentTask: Ref<api.TaskDetail | null>;
  /** 当前任务 token 累计(任务模式统计块数据源) */
  currentTaskUsage: Ref<api.TaskUsageTotal | null>;
  /** 全部任务 token 累计(任务模式「全局累计」) */
  globalTaskUsage: Ref<api.TaskUsageTotal | null>;
  /** 当前任务 LLM 调用记录(批次 3 L3 调用追踪面板) */
  taskCalls: Ref<api.TaskLlmCall[]>;
  /** 流式增量缓冲:key = `${phase}:${step_index ?? ''}`(批次 R4) */
  liveBuffers: Ref<Map<string, string>>;
}

/**
 * 非响应式内部运行时:内容签名、in-flight 合并标志、SSE 定时器与句柄。
 * 这些量刻意不进 ref(改它们不该触发渲染),但必须在各动作模块之间共享同一份,
 * 故集中到一个可变对象里传递。
 */
export interface TaskRuntime {
  detailSignature: string;
  listSignature: string;
  callsSignature: string;
  tasksInflight: boolean;
  tasksPending: boolean;
  usageTotalInflight: boolean;
  usageTotalPending: boolean;
  detailInflight: Map<string, boolean>;
  closeTaskEvents: (() => void) | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  reconnectDelay: number;
  settleTimer: ReturnType<typeof setTimeout> | null;
  taskPollTimer: ReturnType<typeof setInterval> | null;
}

/** 流式缓冲(批次 R4) */
export interface LiveActions {
  liveKey(phase: string, stepIndex?: number): string;
  appendLiveDelta(ev: api.TaskEvent): void;
  clearLiveDelta(phase: string, stepIndex?: number): void;
  clearAllLiveDeltas(): void;
}

/** 加载与选择(含 in-flight 合并 + 内容签名去重) */
export interface LoadActions {
  loadTasks(): Promise<void>;
  loadGlobalTaskUsage(): Promise<void>;
  loadTaskDetail(id: string): Promise<void>;
  loadTaskCalls(taskId: string): Promise<void>;
  selectTask(id: string): Promise<void>;
  clearSelectedTask(): void;
  restoreSelectedTask(): Promise<void>;
}

/** 任务事件 SSE 订阅、重连与兜底轮询(WP5) */
export interface EventActions {
  onTaskEvent(ev: api.TaskEvent): void;
  connectTaskEvents(): void;
  onTaskEventsClosed(err?: Error): void;
  startTaskEvents(): void;
  stopTaskEvents(): void;
  startTaskPolling(): void;
  stopTaskPolling(): void;
}

/** 任务 CRUD(本地乐观更新;后续刷新交给 SSE 事件驱动) */
export interface CrudActions {
  createTask(title: string, characterId?: string): Promise<api.TaskRecord>;
  runTask(id: string): Promise<void>;
  stopTask(id: string): Promise<void>;
  approveTask(id: string, plan?: api.TaskStep[]): Promise<void>;
  followupTask(id: string, content: string, mode?: 'append' | 'replace'): Promise<void>;
  planChatTask(id: string, message: string): Promise<void>;
  deleteTask(id: string): Promise<void>;
}

/** 顶层模式切换与两条持久化写入 */
export interface ModeActions {
  setAppMode(mode: 'roleplay' | 'task'): void;
  persistAppMode(): void;
  persistTaskRunMode(): void;
}

export interface TaskActions extends LiveActions, LoadActions, EventActions, CrudActions, ModeActions {}

/** 动作模块的入参:状态引用 + 共享运行时 + 装配后回填的动作表 */
export interface TaskDeps {
  runtime: TaskRuntime;
  actions: TaskActions;
}
