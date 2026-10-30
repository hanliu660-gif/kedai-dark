// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { restoreNativeDialogs, type DialogTarget } from './nativeDialogs';
import { confirmAction, hasSyncNativeConfirm } from './composables/useConfirm';

/**
 * 端到端回归（2026-10-30 实机缺陷复现）：
 *   桌面端启动时 restoreNativeDialogs() 会装 fallbackConfirm，
 *   而 fallbackConfirm 的 constructor.name 是 'Function'（不是 'AsyncFunction'），
 *   于是 hasSyncNativeConfirm() 误判为「同步原生可用」→ confirmAction 走原生直通分支
 *   → 拿到 fallback 恒返回的 false ⇒ **删除永远按取消**（不报错但不生效）。
 *
 * 这条测试锁定真实链路：模拟 Tauri（无原型、只有异步自有属性）→ restore → confirmAction。
 */
describe('restoreNativeDialogs + confirmAction 端到端（回归）', () => {
  it('桌面端装完兜底后，confirmAction 必须走应用内对话框，而不是被兜底的 false 短路', async () => {
    // 模拟 WebView2：只有自有属性（异步覆写），原型上没有确认方法。
    // 直接用 DialogTarget 类型（restoreNativeDialogs 本就接受它），不写 as unknown as
    // ——类型护栏是 ratchet 只降不升。
    const fakeWindow: DialogTarget = {
      confirm: async () => true,
      alert: async () => undefined,
    };
    vi.stubGlobal('window', fakeWindow);

    restoreNativeDialogs(fakeWindow);

    // 兜底已装上（同步函数）
    expect(typeof fakeWindow.confirm).toBe('function');

    // 关键断言：不能把兜底当成「可用的同步原生」
    expect(hasSyncNativeConfirm()).toBe(false);

    // 走应用内对话框：应入队并等待结算，而不是立刻返回 false
    const p = confirmAction('确定删除?');
    const { pendingConfirm, settleConfirm } = await import('./composables/useConfirm');
    expect(pendingConfirm.value?.message).toBe('确定删除?');
    settleConfirm(true);
    expect(await p).toBe(true);
  });
});
