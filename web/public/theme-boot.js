/*
 * 夜间模式首帧引导(NIGHT-1,2026-10-26 / R1 并轨版)。
 *
 * 为什么单独一个静态文件:偏好存在 localStorage 里,而 Vue 要等 JS 包下载并 mount 之后
 * 才会去挂 <html data-theme="dark">;深色偏好的用户在这个间隙会先看到一帧亮色。
 * 把这段放到 <head> 里的同步 <script src> 就消除了这一帧(静态资源同时在 Tauri 的
 * script-src 'self' 之内,将来收紧 CSP 也不受影响)。
 *
 * 与 web/src/theme.ts 的契约:**存储键、默认值、判定条件三处逐字一致**,改一处必须改两处。
 *   STORAGE_KEY = 'kedai.theme-mode.v1'   DEFAULT_MODE = 'system'
 * 这里只用 ES5(window.localStorage / matchMedia / setAttribute),不 import、不依赖任何构建工具。
 */
(function () {
  /* 恢复原生 window.confirm 与 window.alert:清除 Tauri dialog 插件预注入的异步覆写 */
  try {
    if (typeof window !== 'undefined') {
      if (Object.prototype.hasOwnProperty.call(window, 'confirm')) delete window.confirm;
      if (Object.prototype.hasOwnProperty.call(window, 'alert')) delete window.alert;
    }
  } catch (e) {
    /* 忽略只读环境异常 */
  }

  var STORAGE_KEY = 'kedai.theme-mode.v1';
  var REGISTRY_STORAGE_KEY = 'kedai.theme.v1';
  var DEFAULT_MODE = 'system';
  var mode = DEFAULT_MODE;
  try {
    var raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'system') {
      mode = raw;
    } else {
      // 静默迁移检查：如果只存在上游 kedai.theme.v1
      var rawReg = window.localStorage.getItem(REGISTRY_STORAGE_KEY);
      if (rawReg === 'dark') mode = 'dark';
      else if (rawReg === 'default') mode = 'light';
    }
  } catch (e) {
    /* 隐私模式 / 存储被禁:按默认值走 */
  }
  var dark = mode === 'dark';
  if (mode === 'system') {
    try {
      dark = !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    } catch (e) {
      dark = false;
    }
  }
  if (dark) document.documentElement.setAttribute('data-theme', 'dark');
})();
