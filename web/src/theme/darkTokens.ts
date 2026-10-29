// darkTokens.ts — 暗黑模式设计令牌单一真相源（SSOT）
//
// 契约保证（R3 主题声明层并轨）：
// 1. 本字典是暗黑模式所有 CSS 变量（--sv-* / --shadow-*）的唯一事实源；
// 2. web/src/theme/builtin.ts 中的 DARK_THEME.tokens 直接消费本字典；
// 3. web/src/styles/tokens.css 中的 :root[data-theme='dark'] 与本字典保持逐键逐值 100% 同步；
// 4. styles/darkContrast.test.ts 维持同源双向校验，防漂移断言覆盖全量令牌。

export const DARK_THEME_TOKENS: Record<string, string> = {
  /* ===== 基底:深灰画布,控件靠明度差分层 ===== */
  '--sv-paper': '#0f0f11',
  '--sv-surface': '#1a1b1d',
  '--sv-surface-elevated': '#222325',
  '--sv-white': '#26282b',

  /* ===== 结构:对调(深底浅字) ===== */
  '--sv-ink': '#f2f3f5',
  '--sv-ink-supreme': '#ffffff',
  '--sv-ink-soft': '#d8dade',
  '--sv-ink-dim': '#a3a7ad',
  '--sv-ink-faint': '#8f9399',
  '--sv-line': '#2c2e33',
  '--sv-line-strong': '#3a3d43',
  '--sv-line-soft': '#232529',

  /* ===== 原来的「粉」在暗色下退成中性灰阶(保留五档名字,免得改所有引用点) ===== */
  '--sv-pink': '#26282b',
  '--sv-pink-light': '#1e2024',
  '--sv-pink-medium': '#34373b',
  '--sv-pink-deep': '#a8adb4',
  '--sv-pink-dark': '#8b9098',
  '--sv-pink-deep-rgb': '168, 173, 180',

  /* ===== 语义色:保持色相,明度抬到深底可读(装饰/描边/文字用) ===== */
  '--sv-red': '#e04b42',
  '--sv-red-deep': '#f2776e',
  '--sv-blue': '#5c7fe0',
  '--sv-yellow': '#e8b93c',
  '--sv-yellow-deep': '#f2c65c',
  '--sv-green': '#2fae5f',
  '--sv-green-deep': '#45c777',
  '--sv-purple': '#b06fd0',
  '--sv-orange': '#e8903c',
  '--sv-amber': '#e8a33c',

  /* ===== 色块底:压暗,配浅字(见文件头第 2 条) ===== */
  '--sv-chip-blue': '#7f9df0',
  '--sv-chip-gray': '#8f9399',
  '--sv-chip-yellow': '#6b4f00',
  '--sv-chip-green': '#14663a',
  '--sv-mark-bg': '#6b4f00',

  /* ===== 硬投影:原作是黑色偏移,深底上会隐形 → 改成浅色微光 ===== */
  '--shadow-sm': '3px 3px 0 #ffffff0d',
  '--shadow-card': '4px 4px 0 #ffffff12',
  '--shadow-pink': '4px 4px 0 rgba(var(--sv-pink-deep-rgb), 0.28)',
  '--shadow-pink-strong': '4px 4px 0 rgba(var(--sv-pink-deep-rgb), 0.36)',
  '--shadow-hover': '6px 6px 0 #ffffff1a',
  '--shadow-raise': '4px 4px 0 #ffffff1a',
  '--shadow-sunk': '4px 4px 0 #ffffff14',
  '--shadow-card-soft': '5px 5px 0 #ffffff0f',
  '--shadow-modal': '10px 10px 0 #ffffff1f',
  '--shadow-ctx': '8px 8px 0 #ffffff1a',

  /* ===== 一身二职令牌的配套(见文件头第 1 条) ===== */
  '--sv-on-ink-soft': 'rgba(20, 20, 20, 0.72)',
};
