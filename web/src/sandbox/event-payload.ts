// event-payload.ts — 回沙箱的事件载荷(元素级 / jQuery 全局 / 窗口级共用)
//
// 为什么单独一层:dom-rpc(元素级 .on 与委托)和 draggable(窗口级 bindGlobalEvents、
// draggable 回调)都要发 jq-event,事件体必须同口径带上指针与键盘真值。此前
// draggable.postEvent 只发 {type},作者脚本的窗口级 mousemove/mouseup 收尾
// (Math.hypot(clientX - start.x, …)) 拿到 undefined ⇒ NaN ⇒ 拖拽与点击判定同时静默失效。
// 放独立模块避免 dom-rpc ↔ draggable 循环依赖。

/**
 * 回发沙箱的事件载荷:除了 type 再带上指针/键盘真值。
 * 悬浮球用原生 mousedown/touchstart 的 clientX/clientY 算拖动起点(拖 4px 才算拖),
 * 画布类脚本读 pageX/pageY;只发 {type} 会让这类回调拿到 undefined 后自己崩掉。
 */
export function eventPayload(event: Event, name: string): Record<string, unknown> {
  const out: Record<string, unknown> = { type: name };
  // 测试替身与部分合成事件没有真实 Event 对象(直接以空参调用监听),不能在这里抛错。
  if (!event || typeof event !== 'object') return out;
  const mouse = event as MouseEvent;
  if (typeof mouse.clientX === 'number') {
    out.clientX = mouse.clientX;
    out.clientY = mouse.clientY;
  }
  // 触摸事件(移动端拖动):首个触点坐标,与 clientX/clientY 同口径
  const touch = (event as TouchEvent).touches?.[0];
  if (touch && typeof touch.clientX === 'number') {
    out.clientX = touch.clientX;
    out.clientY = touch.clientY;
    out.pageX = touch.pageX;
    out.pageY = touch.pageY;
  }
  if (typeof mouse.pageX === 'number') {
    out.pageX = mouse.pageX;
    out.pageY = mouse.pageY;
  }
  if (typeof mouse.screenX === 'number') {
    out.screenX = mouse.screenX;
    out.screenY = mouse.screenY;
  }
  if (typeof mouse.button === 'number') out.button = mouse.button;
  const key = event as KeyboardEvent;
  if (typeof key.key === 'string') {
    out.key = key.key;
    if (typeof key.code === 'string') out.code = key.code;
  }
  return out;
}
