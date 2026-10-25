// 任务事件 SSE 订阅(WP5:取代原 1s REST 轮询与本地合成伪事件)与断线重连/兜底轮询。
// 三个窗口值都在 runtime.ts:退避 1s→15s、settle 1.5s 判活、断开期间 5s 兜底轮询。
import * as api from '../../api';
import { reportChatEvent, uiPrefsBridge } from '../storeBridge';
import type { EventActions, TaskDeps, TaskState } from './taskContext';
import {
  CONNECT_SETTLE_MS,
  FALLBACK_POLL_MS,
  RECONNECT_BASE_MS,
  RECONNECT_MAX_MS,
  TERMINAL_STATUSES,
  contentSignature,
} from './runtime';

export function createEventActions(state: TaskState, deps: TaskDeps): EventActions {
  const { runtime, actions } = deps;

  /** 事件分发:按 kind 驱动局部刷新;所有事件原样透传事件监控面板(DevTools) */
  function onTaskEvent(ev: api.TaskEvent): void {
    reportChatEvent(ev);
    switch (ev.kind) {
      case 'created':
        void actions.loadTasks();
        break;
      case 'status':
      case 'plan':
      case 'subtask':
        // 侧栏状态跳动 + 当前任务详情刷新;终态时补全局 token 累计
        void actions.loadTasks();
        if (ev.task_id === state.currentTaskId.value) void actions.loadTaskDetail(ev.task_id);
        if (ev.kind === 'status' && ev.status && TERMINAL_STATUSES.has(ev.status)) {
          void actions.loadGlobalTaskUsage();
        }
        break;
      case 'usage':
        // 高频事件:详情刷新有 in-flight 合并兜底,不会叠加并发请求
        if (ev.task_id === state.currentTaskId.value) void actions.loadTaskDetail(ev.task_id);
        void actions.loadGlobalTaskUsage();
        break;
      case 'llm_call':
        // LLM 调用落库:仅当前任务且「调用情况」tab 被记忆为激活时才拉取(避免无谓请求;
        // 面板合并后 callTraceOpen 语义为合并面板内部 tab 记忆,判断逻辑不变)
        if (ev.task_id === state.currentTaskId.value && uiPrefsBridge().isCallTraceOpen()) {
          void actions.loadTaskCalls(ev.task_id);
        }
        // 批次 R4 流式缓冲对齐:该调用的暂态 delta 已由落库行取代,清对应缓冲
        // (旧服务端事件无 phase 字段 → 不清,残留缓冲随切任务/终态清理)
        if (ev.task_id === state.currentTaskId.value && ev.phase) {
          actions.clearLiveDelta(ev.phase, ev.step_index);
        }
        // finish_reason(可观测性问题①截断标记)透传通道:事件原样进事件监控面板
        // (onSseEvent 已透传 ev.finish_reason),面板数据源由 loadTaskCalls 全量行携带
        // (TaskLlmCall.finish_reason);'length' 即 max_tokens 截断,此处不做增量合并
        break;
      case 'delta':
        // 批次 R4 流式输出:攒批后的正文增量就地追加进 liveBuffers,**绕开**
        // contentSignature 全量重拉链(每 token 全量拉取 + stringify 不可行);
        // 缓冲由 TaskBoard「正在生成」块与 CallTracePanel「进行中」伪行消费
        actions.appendLiveDelta(ev);
        break;
      case 'approval_required':
        // plan 模式计划已生成待批准:刷新列表(状态徽标)与当前任务详情(批准区)
        void actions.loadTasks();
        if (ev.task_id === state.currentTaskId.value) void actions.loadTaskDetail(ev.task_id);
        break;
      case 'agent_status':
        // 主/子 agent 状态迁移(detail 为简述,前端不解析):当前任务刷新详情;
        // 详情刷新有按 id 的 in-flight 合并兜底,事件密集时不叠加并发请求
        if (ev.task_id === state.currentTaskId.value) void actions.loadTaskDetail(ev.task_id);
        break;
      case 'deleted':
        void actions.loadTasks();
        if (state.currentTaskId.value === ev.task_id) {
          state.currentTaskId.value = null;
          state.currentTask.value = null;
          state.currentTaskUsage.value = null;
          state.taskCalls.value = [];
          runtime.callsSignature = contentSignature([]);
          actions.clearAllLiveDeltas(); // 批次 R4:任务删除,其流式缓冲一并失效
        }
        break;
      case undefined:
        // kind 缺失(旧服务端/未知分类):仅透传事件面板,不触发刷新。
        // 这是**契约允许**的向后兼容分支(后端 kind 为 Option + skip_serializing_if),
        // 故显式列出而不靠 default 兜底。
        break;
      default: {
        // 穷尽性断言:后端 TaskEventKind 新增分类而此处漏接线时**编译失败**。
        // 原实现是 default 静默 break,漏改不报错——正是本轮要堵的静默失效点。
        const unhandled: never = ev.kind;
        void unhandled;
        break;
      }
    }
  }

  /** 建立一次事件订阅;settle 窗口内未断开视为连接成功(复位退避 + 停兜底轮询 + 全量刷新) */
  function connectTaskEvents(): void {
    runtime.closeTaskEvents = api.streamTaskEvents(onTaskEvent, onTaskEventsClosed);
    runtime.settleTimer = setTimeout(() => {
      runtime.settleTimer = null;
      // 可观测性(批次 5.3):settle 窗口内未再断开即视为恢复。此处 reconnectDelay 仍大于
      // 起步值,说明本次是「断线后的重连」而非首次连接,才记一行——否则每次进任务模式都会刷。
      // 纯观测,不参与任何判定(退避与重连策略见下方两处,未改)。
      if (runtime.reconnectDelay > RECONNECT_BASE_MS) {
        console.info('[kedai] 任务事件流已恢复(settle 窗口内未再断开),退避复位');
      }
      runtime.reconnectDelay = RECONNECT_BASE_MS;
      stopTaskPolling();
      // 补偿断开期间可能遗漏的变更
      void actions.loadTasks();
      if (state.currentTaskId.value) void actions.loadTaskDetail(state.currentTaskId.value);
      void actions.loadGlobalTaskUsage();
    }, CONNECT_SETTLE_MS);
  }

  /** SSE 关闭回调(对端断开/网络错误):启动兜底轮询,按指数退避安排重连 */
  function onTaskEventsClosed(err?: Error): void {
    runtime.closeTaskEvents = null;
    if (runtime.settleTimer) {
      clearTimeout(runtime.settleTimer);
      runtime.settleTimer = null;
    }
    if (state.appMode.value !== 'task') return; // 已退出任务模式,不再重连
    // 可观测性(批次 5.3):重连过程此前在控制台完全不可见,排查「当时发生了什么」只能靠猜。
    // 记录本次退避值(即下方 setTimeout 实际使用的值)与兜底轮询状态,只加信号不改策略。
    console.warn(
      `[kedai] 任务事件流断开,${runtime.reconnectDelay}ms 后重连(期间 5s 兜底轮询保活)`,
      err,
    );
    startTaskPolling();
    runtime.reconnectTimer = setTimeout(() => {
      runtime.reconnectTimer = null;
      connectTaskEvents();
    }, runtime.reconnectDelay);
    runtime.reconnectDelay = Math.min(runtime.reconnectDelay * 2, RECONNECT_MAX_MS);
  }

  /** 启动任务事件订阅(幂等:已订阅/重连中不重复建立) */
  function startTaskEvents(): void {
    if (runtime.closeTaskEvents || runtime.reconnectTimer) return;
    runtime.reconnectDelay = RECONNECT_BASE_MS;
    connectTaskEvents();
  }

  /** 停止订阅与一切兜底/重连定时器(退出任务模式时调用) */
  function stopTaskEvents(): void {
    if (runtime.reconnectTimer) {
      clearTimeout(runtime.reconnectTimer);
      runtime.reconnectTimer = null;
    }
    if (runtime.settleTimer) {
      clearTimeout(runtime.settleTimer);
      runtime.settleTimer = null;
    }
    stopTaskPolling();
    if (runtime.closeTaskEvents) {
      console.debug('[kedai] 任务事件流订阅已关闭(退出任务模式)');
      runtime.closeTaskEvents();
      runtime.closeTaskEvents = null;
    }
  }

  // ===== 兜底轮询(SSE 断开期间的 5s 低频保活:仅列表 + 当前任务详情) =====
  function startTaskPolling(): void {
    if (runtime.taskPollTimer) return;
    console.debug('[kedai] 任务兜底轮询启动(SSE 断开期间 5s 保活)');
    runtime.taskPollTimer = setInterval(() => {
      void actions.loadTasks();
      if (state.currentTaskId.value) void actions.loadTaskDetail(state.currentTaskId.value);
    }, FALLBACK_POLL_MS);
  }

  function stopTaskPolling(): void {
    if (runtime.taskPollTimer) {
      console.debug('[kedai] 任务兜底轮询停止(事件流已恢复)');
      clearInterval(runtime.taskPollTimer);
      runtime.taskPollTimer = null;
    }
  }

  return {
    onTaskEvent,
    connectTaskEvents,
    onTaskEventsClosed,
    startTaskEvents,
    stopTaskEvents,
    startTaskPolling,
    stopTaskPolling,
  };
}
