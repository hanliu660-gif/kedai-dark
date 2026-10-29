// host-events.ts — 宿主侧(jq-event)高频事件合帧。
//
// 背景:作者脚本拖动/滚动时每个 DOM 事件都要走「宿主 postMessage → 沙箱回调 → 一批 DOM 操作
// → 回包带全量状态镜像(选择器扫描 + 控件扫描 + 所有 kdel 的 rect))」。逐事件往返会把主线程
// 排满(2026-10-29 实跑:拖悬浮球时整页卡顿)。这里在**宿主**可见页面用 rAF 把同一
// (沙箱, jqId, 事件名)的高频事件合并成一条(只保留最新坐标),其余事件原样即时投递。
//
// 为什么不在沙箱侧合帧:沙箱 iframe 是不可见文档(display:none / 0×0),其 realm 内
// requestAnimationFrame 永不回调,任何 rAF 排程都会让事件永久积压(2026-10-29 实测)。

/** 需要合帧的高频事件名(拖动/滚动/指针移动);其余事件必须即时投递保证点击手感 */
export const COALESCED_EVENT_NAMES = [
  'mousemove',
  'pointermove',
  'touchmove',
  'scroll',
  'wheel',
  'drag',
  'dragover',
] as const;

const COALESCED = new Set<string>(COALESCED_EVENT_NAMES);

/** 合帧窗口上限(毫秒):rAF 不可用时(隐藏页/测试环境)的兜底节奏 */
const FRAME_FALLBACK_MS = 16;

interface PendingEvent {
  targetWindow: { postMessage: (message: unknown, targetOrigin: string) => void };
  message: Record<string, unknown>;
}

/** 按 window 分组:同一沙箱内再按 jqId+事件名合并,避免两个沙箱同 jqId 互相覆盖 */
const pending = new WeakMap<object, Map<string, PendingEvent>>();
/** 本帧排过队的 window(WeakMap 不可枚举,flush 时按此集合取) */
const scheduledWindows = new Set<PendingEvent['targetWindow']>();
let scheduled = false;

function flushPending(): void {
  scheduled = false;
  // 取快照后清空:投递期间新到的同键事件会重新排队,等下一帧
  const groups: PendingEvent[] = [];
  for (const win of scheduledWindows) {
    const map = pending.get(win);
    if (!map) continue;
    pending.delete(win);
    for (const item of map.values()) groups.push(item);
  }
  scheduledWindows.clear();
  for (const item of groups) {
    try {
      item.targetWindow.postMessage(item.message, '*');
    } catch {
      /* 沙箱已卸载:丢弃 */
    }
  }
}

function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  const run = (): void => flushPending();
  // 宿主页面可见时用 rAF(跟绘制节奏对齐);无 rAF(测试/后台页)退回定时器,
  // 保证一定会有一次投递 —— 绝不允许事件被永久挂起。
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
  else setTimeout(run, FRAME_FALLBACK_MS);
}

/**
 * 投递一条宿主→沙箱 jq-event:
 * 高频事件(COALESCED_EVENT_NAMES)按 (jqId, 事件名) 合帧,其余即时投递。
 * `eventName` 省略时读 message.event.type。
 */
export function postSandboxEvent(
  targetWindow: { postMessage: (message: unknown, targetOrigin: string) => void } | null | undefined,
  message: Record<string, unknown>,
): void {
  if (!targetWindow) return;
  const evt = message.event as { type?: unknown } | undefined;
  const name = typeof evt?.type === 'string' ? evt.type : '';
  if (!COALESCED.has(name)) {
    targetWindow.postMessage(message, '*');
    return;
  }
  const key = `${String(message.jqId ?? '')}@@${name}`;
  let map = pending.get(targetWindow);
  if (!map) {
    map = new Map<string, PendingEvent>();
    pending.set(targetWindow, map);
  }
  map.set(key, { targetWindow, message });
  scheduledWindows.add(targetWindow);
  schedule();
}

/** 测试用:清空未投递队列(不投递) */
export function resetPendingSandboxEvents(): void {
  scheduledWindows.clear();
  scheduled = false;
}

/** 测试用:立刻投递所有排队事件(等价「手动跑一帧」)。生产代码不需要调用。 */
export function flushPendingSandboxEvents(): void {
  flushPending();
}
