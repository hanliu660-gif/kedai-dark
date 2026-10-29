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
});
