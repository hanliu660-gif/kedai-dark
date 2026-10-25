// @vitest-environment jsdom
// 夜间模式契约测试(NIGHT-1,2026-10-26)。
// 覆盖三件事:① 三档偏好的解析与落盘;② <html data-theme> 的挂/摘(含跟随系统);
// ③ theme-boot.js 与 theme.ts 的「存储键 + 默认值」不许漂移(两条独立真相源,只能靠测试钉住)。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** jsdom 环境下 import.meta.url 是 http 基址,读文件只能走 cwd(web 包根 / 仓库根两种跑法都认)。 */
function readRepoFile(rel: string): string {
  for (const base of [process.cwd(), resolve(process.cwd(), 'web')]) {
    const p = resolve(base, rel);
    if (existsSync(p)) return readFileSync(p, 'utf8');
  }
  throw new Error(`找不到 ${rel}`);
}

const bootJs = readRepoFile('public/theme-boot.js');
const indexHtml = readRepoFile('index.html');

/** 每次用新模块实例,避免模块级 ref 在用例之间串味。 */
async function loadTheme() {
  vi.resetModules();
  return await import('./theme');
}

/** 把系统偏好装成指定值,并回传 change 监听器列表(用于模拟系统切换)。 */
function mockSystemDark(dark: boolean): Array<() => void> {
  const listeners: Array<() => void> = [];
  const mql = {
    matches: dark,
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: (_type: string, fn: () => void) => {
      listeners.push(fn);
    },
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  };
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: () => mql,
  });
  return listeners;
}

const htmlTheme = () => document.documentElement.getAttribute('data-theme');

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('主题三档(默认跟随系统)', () => {
  it('没有存储值时默认 system,系统浅色 → 不挂属性', async () => {
    mockSystemDark(false);
    const theme = await loadTheme();
    expect(theme.themeMode.value).toBe('system');
    theme.installTheme();
    expect(htmlTheme()).toBeNull();
    expect(theme.isDark.value).toBe(false);
  });

  it('存了 dark → 导入即为 dark,installTheme 挂上属性', async () => {
    mockSystemDark(false);
    localStorage.setItem('kedai.theme-mode.v1', 'dark');
    const theme = await loadTheme();
    expect(theme.themeMode.value).toBe('dark');
    theme.installTheme();
    expect(htmlTheme()).toBe('dark');
    expect(theme.isDark.value).toBe(true);
  });

  it('非法存储值回落默认值', async () => {
    mockSystemDark(false);
    localStorage.setItem('kedai.theme-mode.v1', 'sepia');
    const theme = await loadTheme();
    expect(theme.themeMode.value).toBe('system');
  });

  it('setThemeMode 同时落盘、生效、并可从暗切回亮', async () => {
    mockSystemDark(false);
    const theme = await loadTheme();
    theme.installTheme();
    theme.setThemeMode('dark');
    expect(htmlTheme()).toBe('dark');
    expect(localStorage.getItem('kedai.theme-mode.v1')).toBe('dark');
    theme.setThemeMode('light');
    expect(htmlTheme()).toBeNull();
    expect(localStorage.getItem('kedai.theme-mode.v1')).toBe('light');
    expect(theme.isDark.value).toBe(false);
  });

  it('system 模式下系统偏好变化会跟随;显式选档后不再跟随', async () => {
    const listeners = mockSystemDark(true);
    const theme = await loadTheme();
    theme.installTheme();
    expect(htmlTheme()).toBe('dark');
    for (const fn of listeners) fn();
    expect(htmlTheme()).toBe('dark');

    theme.setThemeMode('light');
    expect(htmlTheme()).toBeNull();
    for (const fn of listeners) fn();
    expect(htmlTheme()).toBeNull();
  });

  it('resolveDark 的三档语义', async () => {
    mockSystemDark(true);
    const theme = await loadTheme();
    expect(theme.resolveDark('dark')).toBe(true);
    expect(theme.resolveDark('light')).toBe(false);
    expect(theme.resolveDark('system')).toBe(true);
  });

  it('installTheme 返回的卸载函数摘掉监听(切换系统偏好不再重算)', async () => {
    const listeners = mockSystemDark(false);
    const theme = await loadTheme();
    const uninstall = theme.installTheme();
    uninstall();
    expect(listeners.length).toBe(1);
  });
});

describe('theme-boot.js 与 theme.ts 不许漂移', () => {
  it('两处的存储键与默认值逐字一致', async () => {
    const theme = await loadTheme();
    expect(theme.THEME_STORAGE_KEY).toBe('kedai.theme-mode.v1');
    expect(theme.DEFAULT_THEME_MODE).toBe('system');
    expect(bootJs).toContain(`STORAGE_KEY = '${theme.THEME_STORAGE_KEY}'`);
    expect(bootJs).toContain(`DEFAULT_MODE = '${theme.DEFAULT_THEME_MODE}'`);
  });

  it('theme-boot.js 是 ES5 自执行片段(不 import、不 export)', () => {
    expect(bootJs).not.toMatch(/^\s*(import|export)\s/m);
  });

  it('index.html 在模块脚本之前同步加载 theme-boot.js', () => {
    const bootAt = indexHtml.indexOf('/theme-boot.js');
    const mainAt = indexHtml.indexOf('/src/main.ts');
    expect(bootAt).toBeGreaterThan(-1);
    expect(mainAt).toBeGreaterThan(bootAt);
  });
});
