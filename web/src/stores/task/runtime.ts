// 任务 store 的持久化键、连接参数与运行时对象装配。
// 这些常量原来是 task.ts 顶层的文件级定义,拆分后集中在此,由各动作模块按需 import。
import type * as api from '../../api';
import type { TaskRuntime } from './taskContext';

/** 顶层模式持久化键:刷新后停留在上次模式 */
export const APP_MODE_KEY = 'kedai.appMode';
/** 新建任务模式持久化键(批次 4 六模式):刷新后保持上次选择 */
export const TASK_RUN_MODE_KEY = 'kedai.taskRunMode.v1';
/** 当前选中任务持久化键(实跑问题 4):重启后恢复上次查看的任务详情与调用记录 */
const CURRENT_TASK_KEY = 'kedai.currentTaskId.v1';

/** 任务模式可选值(写持久化前的白名单校验;未知值回退 legacy) */
const TASK_RUN_MODES = new Set(['legacy', 'solo', 'multi', 'plan', 'team', 'custom']);

/** SSE 断线重连:退避起步 1s,指数翻倍,封顶 15s */
export const RECONNECT_BASE_MS = 1000;
export const RECONNECT_MAX_MS = 15000;
/** 连接建立成功的判定窗口:失败(非 2xx/网络错误)通常立即触发 onClose,
 *  存活超过该窗口即视为已恢复(复位退避、停兜底轮询、全量刷新补偿) */
export const CONNECT_SETTLE_MS = 1500;
/** 兜底轮询间隔:SSE 断开期间的低频保活(仅任务列表 + 当前任务详情) */
export const FALLBACK_POLL_MS = 5000;
/** 终态任务状态:事件到达时刷新全局 token 累计 */
export const TERMINAL_STATUSES = new Set(['done', 'partial', 'error', 'ended']);

export function readStoredCurrentTaskId(): string | null {
  try {
    const v = localStorage.getItem(CURRENT_TASK_KEY);
    return v && v.trim() ? v : null;
  } catch {
    return null;
  }
}

export function persistCurrentTaskId(id: string | null): void {
  try {
    if (id) localStorage.setItem(CURRENT_TASK_KEY, id);
    else localStorage.removeItem(CURRENT_TASK_KEY);
  } catch {
    /* 忽略 */
  }
}

export function readStoredAppMode(): 'roleplay' | 'task' {
  try {
    return localStorage.getItem(APP_MODE_KEY) === 'task' ? 'task' : 'roleplay';
  } catch {
    return 'roleplay';
  }
}

export function readStoredTaskRunMode(): api.TaskRunMode {
  try {
    const v = localStorage.getItem(TASK_RUN_MODE_KEY) ?? '';
    return (TASK_RUN_MODES.has(v) ? v : 'legacy') as api.TaskRunMode;
  } catch {
    return 'legacy';
  }
}

/** 内容签名:JSON 序列化(任务详情/列表规模在数十 KB 内,每次 <1ms);失败回退空串(总是替换,退化为旧行为)。
 *  纪律:必须全量序列化——plan 数组的 name/goal/status/result 全字段都在签名内,plan 模式
 *  逐步回写(status/result)与批准替换(goal/name)才会触发引用替换、面板实时更新;
 *  勿回退为字段子集签名(旧轮询期 taskDetailSig 只取 status,漏 result/goal 变更的形态)。 */
export function contentSignature(v: unknown): string {
  try {
    return JSON.stringify(v) ?? '';
  } catch {
    return '';
  }
}

/** 装配一份新的内部运行时(每次 store 实例化各一份;签名与 in-flight 标志初值见原实现) */
export function createTaskRuntime(): TaskRuntime {
  return {
    detailSignature: '',
    listSignature: '',
    callsSignature: '',
    tasksInflight: false,
    tasksPending: false,
    usageTotalInflight: false,
    usageTotalPending: false,
    detailInflight: new Map<string, boolean>(),
    closeTaskEvents: null,
    reconnectTimer: null,
    reconnectDelay: RECONNECT_BASE_MS,
    settleTimer: null,
    taskPollTimer: null,
  };
}
