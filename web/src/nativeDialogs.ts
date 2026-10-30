/**
 * 处理 Tauri 对话框插件注入的 window.confirm / window.alert 覆写。
 *
 * 背景（2026-10-30 实测重写，原版注释的前提是错的，见下）：
 * Tauri 对话框插件 `@tauri-apps/plugin-dialog` 在桌面端页面加载前无条件注入
 * `src/init-iife.js`（`tauri_plugin_dialog::init()` 里 `builder.js_init_script(...)`，
 * **没有关闭开关**），内容等价于：
 *     window.alert   = (msg) => invoke('plugin:dialog|message', ...)
 *     window.confirm = async (msg) => await invoke('plugin:dialog|confirm', ...)
 * 造成两类问题：
 *   1. **语义破坏**：原生 confirm 是同步返回 boolean；覆写成 async 后返回 Promise，
 *      `if (confirm(...))` 把 Promise 当真值 ⇒ **未等用户确认就直接执行**；
 *   2. **ACL 报错**：插件注入脚本仍在调 `plugin:dialog|confirm`，超出 capability 授权时
 *      抛 "Command plugin:dialog|confirm not allowed by ACL"，触发全局异常横幅。
 *
 * 原版的处置是 `delete window.confirm`，注释称「回退至 Window.prototype.confirm」。
 * **这个前提是错的**：浏览器里 confirm/alert 是 **window 的自有属性**，
 * `Window.prototype` 上并没有（实测 jsdom/Chromium 同结论）。删掉自有属性后
 * `window.confirm` 直接变 `undefined`，任何**裸 `confirm(...)`** 抛
 * `ReferenceError: confirm is not defined`（2026-10-30 实机复现，用户点「删除」触发）。
 *
 * 现在的处置分两层：
 *   · **删除覆写**（仍然做）：去掉异步 IPC 版本，避免「未确认就执行」的语义破坏；
 *   · **装安全兜底**（本批新增）：删除后若该方法不可用，装一个**同步**实现，
 *     `confirm` 一律返回 **false**、`alert` 静默（含 `console.warn`）。
 *     理由：IPC 天生异步，**无法伪造同步阻塞**；与其让裸调用抛 ReferenceError 把界面
 *     打红，不如保守地「按取消处理」并留下日志。
 *
 * ⚠️ 兜底只是**安全网**，不是解法：应用内的正确入口是 `composables/useConfirm.ts`
 * 的 `confirmAction` / `alertAction`（Promise 化、桌面端走应用内对话框）。
 * 新代码不要再用裸 confirm/alert；本文件保证遗留调用不至于崩掉整个界面。
 */
export interface DialogTarget {
  confirm?: unknown;
  alert?: unknown;
}

/**
 * 兜底实现的身份标记（2026-10-30 实机回归修复）。
 *
 * 为什么必须有它：`useConfirm.hasSyncNativeConfirm()` 靠 `constructor.name` 区分
 * 「原生同步」与「Tauri 异步覆写」——但**兜底函数是普通函数**（constructor.name
 * 也是 'Function'），会被误判成「同步原生可用」，于是 confirmAction 走原生直通分支，
 * 拿到兜底恒返回的 false ⇒ **删除类操作永远按取消**（不报错、但点了没反应）。
 * 故给兜底函数打一个标记，判据同时检查该标记即可识别。
 *
 * 性能/类型说明：用 `Reflect.set` / `Reflect.get` 而非 `as unknown as` 断言——
 * 类型护栏是 ratchet 只降不升，不能为打标记抬高 `as unknown as` 基线。
 *
 * @internal 仅本模块与其判据使用
 */
const FALLBACK_MARK = '__kedaiFallbackDialog';

/** 兜底 confirm：同步返回 false（保守按「取消」处理，不擅自执行破坏性操作）。 */
function fallbackConfirm(message?: string): boolean {
  try {
    console.warn('[kedai] confirm 不可用（原生同步方法缺失），已按取消处理:', message ?? '');
  } catch {
    /* 忽略 */
  }
  return false;
}
Reflect.set(fallbackConfirm, FALLBACK_MARK, true);

/** 兜底 alert：同步返回，不阻塞；仅记录日志。 */
function fallbackAlert(message?: string): void {
  try {
    console.warn('[kedai] alert 不可用（原生同步方法缺失），内容已记入日志:', message ?? '');
  } catch {
    /* 忽略 */
  }
}
Reflect.set(fallbackAlert, FALLBACK_MARK, true);

/** 判断某个 confirm/alert 是否为本模块安装的兜底实现（供 useConfirm 识别）。 */
export function isFallbackDialog(fn: unknown): boolean {
  return typeof fn === 'function' && Reflect.get(fn, FALLBACK_MARK) === true;
}

/**
 * 移除 Tauri 插件注入的异步覆写，并保证 `window.confirm` / `window.alert`
 * 始终是**可调用的同步函数**（原生可用就用原生，否则装兜底）。
 *
 * @param target 调用目标（缺省为全局 window；测试可传替代对象）
 */
export function restoreNativeDialogs(target?: DialogTarget | Window | null): void {
  const win = target !== undefined ? target : (typeof window !== 'undefined' ? window : null);
  if (!win || typeof win !== 'object') return;
  const targetObj = win as Record<string, unknown>;

  // 1) 删除自有属性覆写（插件版是 async IPC，语义错误且可能撞 ACL）
  try {
    if (Object.prototype.hasOwnProperty.call(targetObj, 'confirm')) delete targetObj.confirm;
  } catch {
    /* 忽略只读环境异常 */
  }
  try {
    if (Object.prototype.hasOwnProperty.call(targetObj, 'alert')) delete targetObj.alert;
  } catch {
    /* 忽略只读环境异常 */
  }

  // 2) 兜底：删除后若不可调用（WebView2 里原型没有该方法），装同步安全实现。
  //    注意判据是「不是可用函数」，不能用 hasOwnProperty——原生方法在浏览器里
  //    本来就是自有属性，删掉就不再存在。
  try {
    if (typeof targetObj.confirm !== 'function') {
      targetObj.confirm = fallbackConfirm;
    }
  } catch {
    /* 忽略只读环境异常 */
  }
  try {
    if (typeof targetObj.alert !== 'function') {
      targetObj.alert = fallbackAlert;
    }
  } catch {
    /* 忽略只读环境异常 */
  }
}
