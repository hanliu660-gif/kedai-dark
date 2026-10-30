import { beforeEach, describe, expect, it, vi } from 'vitest';
// @vitest-environment jsdom
import {
  alertAction,
  clearConfirmQueue,
  confirmAction,
  confirmQueueSize,
  hasSyncNativeConfirm,
  pendingConfirm,
  settleConfirm,
} from './useConfirm';

/**
 * useConfirm 单测（2026-10-30 对话框结构性修复）
 *
 * 覆盖三件事：
 *  ① 同步原生可用时（浏览器/jsdom）**不改行为**——直接走原生，不入队；
 *  ② 同步原生不可用时（Tauri 异步覆写 / 属性被删）入队并返回 Promise，
 *     由 settleConfirm 结算；取消按 false，绝不让调用方挂起；
 *  ③ 队列串行：多个请求同时存在时只暴露队首，逐个结算。
 */
describe('useConfirm', () => {
  beforeEach(() => {
    clearConfirmQueue();
    // jsdom 默认自带可用的同步 confirm/alert，先还原成「原生可用」基线
    vi.restoreAllMocks();
  });

  describe('同步原生可用时（浏览器/jsdom）', () => {
    it('confirmAction 直接走原生 confirm，不入队，返回其结果', async () => {
      const native = vi.fn(() => true);
      vi.stubGlobal('confirm', native);
      expect(hasSyncNativeConfirm()).toBe(true);

      const ok = await confirmAction('要继续吗?');
      expect(native).toHaveBeenCalledTimes(1);
      expect(native).toHaveBeenCalledWith('要继续吗?');
      expect(ok).toBe(true);
      expect(confirmQueueSize.value).toBe(0);
      expect(pendingConfirm.value).toBeNull();
    });

    it('原生返回 false 时 confirmAction 也返回 false', async () => {
      vi.stubGlobal('confirm', vi.fn(() => false));
      expect(await confirmAction('x')).toBe(false);
    });

    it('alertAction 直接走原生 alert', () => {
      const native = vi.fn();
      vi.stubGlobal('alert', native);
      void alertAction('提示文本');
      expect(native).toHaveBeenCalledWith('提示文本');
    });
  });

  describe('同步原生不可用时（桌面端）', () => {
    it('confirmAction 入队并暴露队首，settleConfirm(true) 结算为 true', async () => {
      // 模拟 Tauri 覆写：async 函数（constructor.name 为 AsyncFunction）
      vi.stubGlobal('confirm', async () => true);
      expect(hasSyncNativeConfirm()).toBe(false);

      const p = confirmAction('确定删除?', { danger: true, confirmLabel: '删除' });
      expect(confirmQueueSize.value).toBe(1);
      expect(pendingConfirm.value?.message).toBe('确定删除?');
      expect(pendingConfirm.value?.danger).toBe(true);
      expect(pendingConfirm.value?.confirmLabel).toBe('删除');

      settleConfirm(true);
      expect(await p).toBe(true);
      expect(confirmQueueSize.value).toBe(0);
    });

    it('settleConfirm(false) = 取消，调用方拿到 false', async () => {
      vi.stubGlobal('confirm', async () => true);
      const p = confirmAction('确定?');
      settleConfirm(false);
      expect(await p).toBe(false);
    });

    it('confirm 属性被删除(undefined)时同样入队，不抛 ReferenceError', async () => {
      vi.stubGlobal('confirm', undefined);
      expect(hasSyncNativeConfirm()).toBe(false);
      const p = confirmAction('确定?');
      expect(pendingConfirm.value).not.toBeNull();
      settleConfirm(true);
      expect(await p).toBe(true);
    });

    it('alertAction 入队为「只有确认按钮」的提示形态', () => {
      vi.stubGlobal('alert', async () => undefined);
      void alertAction('提示');
      const req = pendingConfirm.value;
      expect(req?.message).toBe('提示');
      // cancelLabel 空串 = 提示模式（ConfirmDialog 据此不渲染取消按钮）
      expect(req?.cancelLabel).toBe('');
      settleConfirm(true);
    });

    it('重复结算幂等：第二次 settleConfirm 不会重复出队或二次 resolve', async () => {
      vi.stubGlobal('confirm', async () => true);
      const p = confirmAction('确定?');
      settleConfirm(true);
      expect(await p).toBe(true);
      expect(confirmQueueSize.value).toBe(0);
      // 队列已空，再结算不应报错
      expect(() => settleConfirm(false)).not.toThrow();
    });
  });

  describe('队列串行', () => {
    it('多个请求排队：只暴露队首，逐个结算依次推进', async () => {
      vi.stubGlobal('confirm', async () => true);
      const p1 = confirmAction('第一个');
      const p2 = confirmAction('第二个');
      expect(confirmQueueSize.value).toBe(2);
      expect(pendingConfirm.value?.message).toBe('第一个');

      settleConfirm(true);
      expect(await p1).toBe(true);
      // 队首推进到第二个
      expect(pendingConfirm.value?.message).toBe('第二个');
      settleConfirm(false);
      expect(await p2).toBe(false);
      expect(confirmQueueSize.value).toBe(0);
    });

    it('clearConfirmQueue 把未结算请求全部按 false 结算，不留挂起 Promise', async () => {
      vi.stubGlobal('confirm', async () => true);
      const p1 = confirmAction('a');
      const p2 = confirmAction('b');
      clearConfirmQueue();
      expect(await p1).toBe(false);
      expect(await p2).toBe(false);
      expect(confirmQueueSize.value).toBe(0);
      expect(pendingConfirm.value).toBeNull();
    });
  });
});
