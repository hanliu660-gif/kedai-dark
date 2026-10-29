// builtin.ts — 内置主题: 默认纸面 + 夜间暗黑模式。
// 主题只声明令牌/类名/字体/CSS，不持有 DOM；外部插件通过 window.KedaiUI 注册同形状的主题。
import type { ThemeDefinition } from './registry';

export const DEFAULT_THEME: ThemeDefinition = {
  id: 'default',
  name: '纸面 · 至上主义',
  description: '淡粉纸面、黑方块与红斜线；Kedai 的原始构成主义骨架。',
};

export const DARK_THEME: ThemeDefinition = {
  id: 'dark',
  name: '暗黑模式',
  description: '夜间模式暗黑主题。基于 tokens.css 与深色石质外壳构筑的深色界面。',
};

export const BUILTIN_THEMES: ThemeDefinition[] = [DEFAULT_THEME, DARK_THEME];
