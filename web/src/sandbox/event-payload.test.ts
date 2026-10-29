// event-payload.test.ts — 回沙箱事件载荷的单测
//
// 背景:卡脚本「悬浮球-0613」的窗口级 mousemove/mouseup 收尾会算
// Math.hypot(clientX - start.x, …),只发 {type} 时拿到 undefined ⇒ NaN ⇒
// 拖拽与「点球开面板」判定同时静默失效(现场证据:沙箱收到
// {"type":"mousemove","hasClientX":false,"keys":["type"]})。
// 这里锁死四种形态:鼠标 / 触摸 / 键盘 / 无参(测试替身直接空参调用监听)。

import { describe, expect, it } from 'vitest';
import { eventPayload } from './event-payload';

// 事件替身:沙箱/测试里监听可能被空参调用,Event 只是形参类型,故用裸断言不带 as unknown as
const asEvent = (o: unknown): Event => o as Event;

describe('eventPayload(回沙箱的事件载荷)', () => {
  it('鼠标事件带指针真值(type/clientX/clientY/pageX/pageY/screenX/button)', () => {
    const ev = {
      clientX: 120,
      clientY: 80,
      pageX: 148,
      pageY: 210,
      screenX: 320,
      screenY: 298,
      button: 0,
    };
    expect(eventPayload(asEvent(ev), 'mousemove')).toEqual({
      type: 'mousemove',
      clientX: 120,
      clientY: 80,
      pageX: 148,
      pageY: 210,
      screenX: 320,
      screenY: 298,
      button: 0,
    });
  });

  it('触摸事件取首个触点坐标,并覆盖鼠标口径', () => {
    const ev = { touches: [{ clientX: 11, clientY: 22, pageX: 33, pageY: 44 }] };
    expect(eventPayload(asEvent(ev), 'touchmove')).toEqual({
      type: 'touchmove',
      clientX: 11,
      clientY: 22,
      pageX: 33,
      pageY: 44,
    });
  });

  it('键盘事件带 key 与 code', () => {
    expect(eventPayload(asEvent({ key: 'Escape', code: 'Esc' }), 'keydown')).toEqual({
      type: 'keydown',
      key: 'Escape',
      code: 'Esc',
    });
  });

  it('空参/非对象不抛错,只回 { type }(测试替身与合成事件)', () => {
    expect(eventPayload(asEvent(undefined), 'mouseup')).toEqual({ type: 'mouseup' });
    expect(eventPayload(asEvent({}), 'mouseup')).toEqual({ type: 'mouseup' });
  });
});
