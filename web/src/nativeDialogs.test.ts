import { describe, expect, it } from 'vitest';
import { type DialogTarget, restoreNativeDialogs } from './nativeDialogs';

describe('restoreNativeDialogs (移除 Tauri dialog 插件注入的异步 IPC 覆写)', () => {
  it('当 target 具有自有属性 confirm 时,删除自有属性并回退到原型上的原生方法', () => {
    const proto: DialogTarget = {
      confirm: function nativeConfirm() {
        return true;
      },
    };
    const mockWindow: DialogTarget = Object.create(proto);
    mockWindow.confirm = async function hijackedConfirm() {
      return false;
    };

    expect(Object.prototype.hasOwnProperty.call(mockWindow, 'confirm')).toBe(true);

    restoreNativeDialogs(mockWindow);

    expect(Object.prototype.hasOwnProperty.call(mockWindow, 'confirm')).toBe(false);
    expect(mockWindow.confirm).toBe(proto.confirm);
  });

  it('当 target 具有自有属性 alert 时,删除自有属性并回退到原型上的原生方法', () => {
    const proto: DialogTarget = {
      alert: function nativeAlert() {},
    };
    const mockWindow: DialogTarget = Object.create(proto);
    mockWindow.alert = function hijackedAlert() {};

    expect(Object.prototype.hasOwnProperty.call(mockWindow, 'alert')).toBe(true);

    restoreNativeDialogs(mockWindow);

    expect(Object.prototype.hasOwnProperty.call(mockWindow, 'alert')).toBe(false);
    expect(mockWindow.alert).toBe(proto.alert);
  });

  it('当 target 无自有属性 confirm/alert 时,保持原型方法不受影响', () => {
    const proto: DialogTarget = {
      confirm: function nativeConfirm() {
        return true;
      },
      alert: function nativeAlert() {},
    };
    const mockWindow: DialogTarget = Object.create(proto);

    restoreNativeDialogs(mockWindow);

    expect(mockWindow.confirm).toBe(proto.confirm);
    expect(mockWindow.alert).toBe(proto.alert);
  });

  it('传入 null / undefined / 非对象时安全退出不报错', () => {
    expect(() => restoreNativeDialogs(null)).not.toThrow();
    expect(() => restoreNativeDialogs(undefined)).not.toThrow();
    expect(() => restoreNativeDialogs()).not.toThrow();
  });

  // 2026-10-30 实机缺陷回归:WebView2 里 confirm/alert 是 window 的**自有属性**,
  // Window.prototype 上并没有。原实现只 delete 不兜底 ⇒ 删完变 undefined ⇒
  // 任何裸 `confirm(...)` 抛 ReferenceError（用户点「删除会话」时触发红条）。
  describe('删除覆写后必须留可调用的同步兜底(2026-10-30 回归)', () => {
    it('无原型可回退时,删除后装入兜底函数而非留 undefined', () => {
      // 模拟 WebView2:只有自有属性(异步覆写),原型上没有
      const mockWindow: DialogTarget = {
        confirm: async () => true,
        alert: async () => undefined,
      };
      restoreNativeDialogs(mockWindow);
      expect(typeof mockWindow.confirm).toBe('function');
      expect(typeof mockWindow.alert).toBe('function');
    });

    it('兜底 confirm 同步返回 false(保守按取消,不擅自执行破坏性操作)', () => {
      const mockWindow: DialogTarget = { confirm: async () => true, alert: async () => undefined };
      restoreNativeDialogs(mockWindow);
      const confirmFn = mockWindow.confirm as (msg?: string) => unknown;
      const out = confirmFn('确定删除?');
      // 必须是同步布尔(不是 Promise),否则 `if (confirm(...))` 又会把 Promise 当真值
      expect(out).toBe(false);
      expect(out).not.toBeInstanceOf(Promise);
    });

    it('兜底 alert 同步返回 undefined,不抛错', () => {
      const mockWindow: DialogTarget = { confirm: async () => true, alert: async () => undefined };
      restoreNativeDialogs(mockWindow);
      const alertFn = mockWindow.alert as (msg?: string) => unknown;
      expect(() => alertFn('提示')).not.toThrow();
      expect(alertFn('提示')).toBeUndefined();
    });

    it('原型上确实有原生方法时,不装兜底(沿用原生)', () => {
      const proto: DialogTarget = { confirm: () => true, alert: () => undefined };
      const mockWindow: DialogTarget = Object.create(proto);
      mockWindow.confirm = async () => false;
      restoreNativeDialogs(mockWindow);
      expect(mockWindow.confirm).toBe(proto.confirm);
      expect(mockWindow.alert).toBe(proto.alert);
    });
  });
});
