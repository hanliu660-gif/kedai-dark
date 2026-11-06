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

  /* 配色首帧引导(2026-11-03):与 theme.ts 的 PALETTE_STORAGE_KEY / PALETTES 白名单一致。
     白名单在此内联是为了不 import(本文件必须在任何包加载前同步执行);
     theme/palettes.test.ts 会校验这份名单与 TS 侧 PALETTES 完全相同,防止加配色时漏改。 */
  var PALETTE_KEY = 'kedai.palette.v1';
  var PALETTE_IDS = ['mist', 'sage', 'oat', 'mauve', 'oled'];
  try {
    var palette = window.localStorage.getItem(PALETTE_KEY);
    if (palette && PALETTE_IDS.indexOf(palette) >= 0) {
      document.documentElement.setAttribute('data-palette', palette);
      /* 纯黑是「只做深色」的配色:仅在**用户没有显式选浅色**时才补挂深色。
         2026-11-03 修:原实现只要 palette=oled 就无条件挂 dark,导致
         「显式选了浅色 → 刷新 → 又被按回深色」,看起来像"切不回去浅色"。
         显式 light 的优先级高于配色兜底。 */
      if (palette === 'oled' && mode !== 'light') {
        document.documentElement.setAttribute('data-theme', 'dark');
      }
    }
  } catch (e) {
    /* 隐私模式 / 存储被禁:不挂配色,走基底 */
  }
})();
