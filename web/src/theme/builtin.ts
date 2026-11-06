// builtin.ts — 内置主题: 默认纸面 + 夜间暗黑模式。
// 主题只声明令牌/类名/字体/CSS，不持有 DOM；外部插件通过 window.KedaiUI 注册同形状的主题。
import type { ThemeDefinition } from './registry';

export const DEFAULT_THEME: ThemeDefinition = {
  id: 'default',
  name: '纸面 · 至上主义',
  description: '淡粉纸面、黑方块与红斜线；Kedai 的原始构成主义骨架。',
};

// 注意(2026-11-03):这里**刻意不带 tokens**。
// registry.apply 会把 tokens 写成 <html style="--sv-paper:...">,而内联样式压过任何选择器,
// 于是 styles/palettes.css 里 `:root[data-theme='dark'][data-palette='xxx']` 永远被顶掉 ——
// 深色下点任何配色都"没反应"(纯黑也吃不到 #000)。暗色令牌的唯一落点是
// styles/tokens.css 的 :root[data-theme='dark'](与 darkTokens.ts 由 darkContrast.test.ts 双向同源校验)。
export const DARK_THEME: ThemeDefinition = {
  id: 'dark',
  name: '暗黑模式',
  description: '夜间模式暗黑主题。基于 tokens.css 与深色石质外壳构筑的深色界面。',
};

export const BUILTIN_THEMES: ThemeDefinition[] = [DEFAULT_THEME, DARK_THEME];
