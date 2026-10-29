/**
 * 恢复原生 window.confirm 与 window.alert:
 *
 * 背景:
 * Tauri 对话框插件 (@tauri-apps/plugin-dialog) 在桌面端启动时注入 init-iife.js,
 * 强行将 window.confirm 替换为异步 IPC (invoke('plugin:dialog|confirm'))。
 * 这导致两个严重问题:
 * 1. 语义破坏: 原生 confirm 是同步阻塞并返回 boolean, 覆写为 async 函数后返回 Promise,
 *    所有 `if (confirm(...))` 将 Promise 视为真值, 未等用户确认即直接执行确认分支;
 * 2. ACL 报错: Tauri 2.7+ 将 confirm 命令重构为 message 命令, 插件自带权限 allow-confirm
 *    仅允许 message, 但注入脚本仍调用 plugin:dialog|confirm, 导致 Tauri 权限系统拦截并抛出:
 *    "Command plugin:dialog|confirm not allowed by ACL", 并触发全局错误兜底横幅。
 *
 * 处置:
 * 移除 window 上的自有属性覆写, 回退至浏览器 / WebView2 原生的同步阻塞 Window.prototype.confirm。
 */
export interface DialogTarget {
  confirm?: unknown;
  alert?: unknown;
}

export function restoreNativeDialogs(target?: DialogTarget | Window | null): void {
  const win = target !== undefined ? target : (typeof window !== 'undefined' ? window : null);
  if (!win || typeof win !== 'object') return;
  const targetObj: DialogTarget = win;
  try {
    if (Object.prototype.hasOwnProperty.call(targetObj, 'confirm')) {
      delete targetObj.confirm;
    }
  } catch {
    /* 忽略只读环境异常 */
  }
  try {
    if (Object.prototype.hasOwnProperty.call(targetObj, 'alert')) {
      delete targetObj.alert;
    }
  } catch {
    /* 忽略只读环境异常 */
  }
}
