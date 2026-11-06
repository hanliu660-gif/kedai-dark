// @vitest-environment jsdom
// 明暗档 × 配色 的切换回归(2026-11-03)。
//
// 背景:加了「纯黑」这种 darkOnly 配色后,设置页要保证三条不变量——
//   1. 选纯黑 ⇒ 自动进深色(否则挂了个在浅色下不存在的配色);
//   2. 从纯黑点任何一个普通配色 ⇒ 回到用户原来的明暗档(不是困在深色里);
//   3. 从纯黑切回浅色 ⇒ data-theme 与 data-palette 都必须被摘掉。
// 第 2 条是现场反馈的「点完纯黑,按哪个按钮都回不去」:按钮其实点了、paletteId 也变了,
// 但明暗档被永久顶成深色,视觉上毫无变化。这里用 jsdom 把 <html> 上的属性当事实断言。
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearAutoDarkMode,
  isDark,
  paletteId,
  selectPalette,
  setPalette,
  setThemeMode,
  systemPrefersDark,
  themeMode,
} from '../theme';
import type { ThemeMode } from '../theme';
import { paletteById } from './palettes';

const html = (): HTMLElement => document.documentElement;

/** 复刻 UiSection.onThemeMode */
function clickThemeMode(next: ThemeMode): void {
  clearAutoDarkMode();
  const willBeLight = next === 'light' || (next === 'system' && !systemPrefersDark());
  if (willBeLight && paletteById(paletteId.value).darkOnly) setPalette('default');
  setThemeMode(next);
}

/** 复刻 UiSection.onPalette(直接走生产实现,不再手抄一份) */
function clickPalette(id: string): void {
  selectPalette(id);
}

/** applyTheme 是异步的(registry.apply 尾部还 await 了资源加载),等两轮微任务足够。 */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('明暗档 × 配色 切换', () => {
  beforeEach(async () => {
    localStorage.clear();
    clearAutoDarkMode();
    setPalette('default');
    setThemeMode('light');
    await settle();
  });

  it('选纯黑:自动切深色,并挂上 data-palette', async () => {
    clickPalette('oled');
    await settle();
    expect(html().getAttribute('data-theme')).toBe('dark');
    expect(html().getAttribute('data-palette')).toBe('oled');
    expect(localStorage.getItem('kedai.palette.v1')).toBe('oled');
  });

  it('纯黑 → 浅色:data-theme 与 data-palette 必须同时消失', async () => {
    clickPalette('oled');
    await settle();
    clickThemeMode('light');
    await settle();

    expect(html().hasAttribute('data-theme')).toBe(false);
    expect(html().hasAttribute('data-palette')).toBe(false);
    expect(isDark.value).toBe(false);
    expect(paletteId.value).toBe('default');
    expect(localStorage.getItem('kedai.palette.v1')).toBe('default');
    expect(localStorage.getItem('kedai.theme-mode.v1')).toBe('light');
  });

  it('纯黑 → 跟随系统(系统为浅色):同样退回浅色', async () => {
    // jsdom 的 matchMedia 恒为 false(不匹配 dark),等价于"系统浅色"
    clickPalette('oled');
    await settle();
    clickThemeMode('system');
    await settle();
    expect(html().hasAttribute('data-theme')).toBe(false);
    expect(html().hasAttribute('data-palette')).toBe(false);
    // 「跟随系统 + 系统浅色」= 浅色:darkOnly 配色必须回落,否则按钮显示纯黑、界面却是浅色
    expect(paletteId.value).toBe('default');
  });

  it('浅色下选纯黑以外的配色:不改变明暗档', async () => {
    clickPalette('mist');
    await settle();
    expect(html().hasAttribute('data-theme')).toBe(false);
    expect(html().getAttribute('data-palette')).toBe('mist');
  });

  // ---- 现场 bug(2026-11-03):点完纯黑,按任何一个配色按钮都"回不去" ----
  it('纯黑 → 雾蓝:还原为浅色,并挂上雾蓝', async () => {
    clickPalette('oled');
    await settle();
    clickPalette('mist');
    await settle();

    expect(themeMode.value).toBe('light');
    expect(isDark.value).toBe(false);
    expect(html().hasAttribute('data-theme')).toBe(false);
    expect(html().getAttribute('data-palette')).toBe('mist');
    expect(localStorage.getItem('kedai.theme-mode.v1')).toBe('light');
    expect(localStorage.getItem('kedai.palette.v1')).toBe('mist');
  });

  it('纯黑 → 纸面:回到原始浅色纸面,且不残留任何主题属性', async () => {
    clickPalette('oled');
    await settle();
    clickPalette('default');
    await settle();

    expect(themeMode.value).toBe('light');
    expect(html().hasAttribute('data-theme')).toBe(false);
    expect(html().hasAttribute('data-palette')).toBe(false);
  });

  it('「跟随系统(浅)」下选纯黑,再选其它配色:仍回到跟随系统', async () => {
    clickThemeMode('system');
    await settle();
    clickPalette('oled');
    await settle();
    expect(themeMode.value).toBe('dark');

    clickPalette('sage');
    await settle();
    expect(themeMode.value).toBe('system');
    expect(html().getAttribute('data-palette')).toBe('sage');
  });

  it('用户自己显式选了深色,再离开纯黑:保持深色不还原', async () => {
    clickPalette('oled');
    await settle();
    clickThemeMode('dark'); // 显式要深色 → 自动切换的记忆作废
    clickPalette('oat');
    await settle();

    expect(themeMode.value).toBe('dark');
    expect(html().getAttribute('data-theme')).toBe('dark');
    expect(html().getAttribute('data-palette')).toBe('oat');
  });

  it('刷新后退出纯黑:还原依据落在 localStorage,不依赖模块内存', async () => {
    clickPalette('oled');
    await settle();
    expect(localStorage.getItem('kedai.palette-autodark.v1')).toBe('light');
  });
});
