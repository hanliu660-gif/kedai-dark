// host-events.test.ts — 宿主侧高频事件合帧(拖动/滚动时把逐像素事件合并成一帧一条)
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  COALESCED_EVENT_NAMES,
  postSandboxEvent,
  resetPendingSandboxEvents,
} from './host-events';

// 手动控制 rAF:
// 把回调捕获到这个小盒子里,由用例调用 rafBox.cb?.() 触发「下一帧」(避免用双重断言逃逸类型)
const rafBox: { cb?: () => void } = {};

interface Sent {
  message: Record<string, unknown>;
}

function makeWindow(): { sent: Sent[]; postMessage: (m: unknown) => void } {
  const sent: Sent[] = [];
  return {
    sent,
    postMessage: (m: unknown) => {
      sent.push({ message: m as Record<string, unknown> });
    },
  };
}

function evt(jqId: number, type: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { type: 'jq-event', jqId, event: { type, ...extra } };
}

afterEach(() => {
  resetPendingSandboxEvents();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('宿主侧事件合帧 postSandboxEvent', () => {
  it('高频事件(mousemove)只投递最新一条', () => {
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
      // 手动控制:捕获回调,稍后触发(等价「下一帧」)
      rafBox.cb = cb;
      return 1;
    });
    const win = makeWindow();
    postSandboxEvent(win, evt(7, 'mousemove', { clientX: 10 }));
    postSandboxEvent(win, evt(7, 'mousemove', { clientX: 20 }));
    // 排程前一条都还没投出去
    expect(win.sent).toHaveLength(0);
    rafBox.cb?.();
    expect(win.sent).toHaveLength(1);
    expect((win.sent[0].message.event as { clientX: number }).clientX).toBe(20);
  });

  it('点击类事件立即投递(不受合帧影响)', () => {
    vi.stubGlobal('requestAnimationFrame', () => 1);
    const win = makeWindow();
    postSandboxEvent(win, evt(7, 'click'));
    expect(win.sent).toHaveLength(1);
    expect((win.sent[0].message.event as { type: string }).type).toBe('click');
  });

  it('不同 jqId 的同名高频事件互不覆盖', () => {
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
      rafBox.cb = cb;
      return 1;
    });
    const win = makeWindow();
    postSandboxEvent(win, evt(7, 'mousemove', { clientX: 11 }));
    postSandboxEvent(win, evt(8, 'mousemove', { clientX: 22 }));
    rafBox.cb?.();
    expect(win.sent.map((s) => (s.message.event as { clientX: number }).clientX).sort((a, b) => a - b)).toEqual([
      11, 22,
    ]);
  });

  it('无 rAF 环境(测试/后台页)退化为定时器投递,绝不永久挂起', async () => {
    vi.stubGlobal('requestAnimationFrame', undefined);
    const win = makeWindow();
    postSandboxEvent(win, evt(7, 'scroll', { scrollTop: 42 }));
    await new Promise((r) => setTimeout(r, 40));
    expect(win.sent).toHaveLength(1);
    expect((win.sent[0].message.event as { scrollTop: number }).scrollTop).toBe(42);
  });

  it('投递目标为空(null/undefined)时安全返回', () => {
    expect(() => postSandboxEvent(null, evt(7, 'mousemove'))).not.toThrow();
    expect(() => postSandboxEvent(undefined, evt(7, 'click'))).not.toThrow();
  });

  it('COALESCED_EVENT_NAMES 覆盖拖动/滚动/指针移动', () => {
    expect(new Set(COALESCED_EVENT_NAMES)).toEqual(
      new Set(['mousemove', 'pointermove', 'touchmove', 'scroll', 'wheel', 'drag', 'dragover']),
    );
  });
});
