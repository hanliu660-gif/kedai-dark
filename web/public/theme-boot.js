/* 首屏防闪：在样式与主脚本加载之前，就把 data-theme 写到 <html> 上。
 *
 * 为什么必须是独立文件、不能写成内联 <script>：
 * 全站 CSP 是 `script-src 'self'`（见 server-rs/src/api/security.rs），
 * 没有 'unsafe-inline' 也没有 nonce/hash，内联脚本会被浏览器静默拦掉——
 * 不报错、不执行，表现就是「首屏闪一帧浅色」，极难查。
 *
 * 这里的默认值必须和 web/src/theme.ts 的 DARK_BY_DEFAULT 保持一致，
 * 否则主题生效前后会看到一次跳变。
 */
(function () {
  try {
    var stored = localStorage.getItem('kedai.theme.v1');
    var mode =
      stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'dark';
    var dark =
      mode === 'dark' ||
      (mode === 'system' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) document.documentElement.setAttribute('data-theme', 'dark');
  } catch (e) {
    // localStorage 被禁用之类：交给 theme.ts 兜底，大不了闪一帧
  }
})();
