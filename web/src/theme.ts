// 夜间模式:主题偏好与 <html data-theme="dark"> 的挂载(NIGHT-1,2026-10-26)
//
// 设计约束(改之前先读):
// - 本模块只决定 <html> 上挂不挂 data-theme="dark";具体颜色全部由 styles/tokens.css
//   末尾的 `:root[data-theme='dark']` 覆写 --sv-* 令牌决定 —— **不要在这里写任何颜色**。
// - 首帧防闪另有一个独立的 web/public/theme-boot.js 在 <head> 里同步跑(比内联脚本稳:
//   Tauri 的 CSP 配置将来若收紧,静态资源仍在 script-src 'self' 之内)。
//   两处的存储键、默认值、判定条件必须逐字一致,否则启动时会闪一帧浅色。
// - 刻意不放进 pinia store:主题是纯展示偏好,不需要进持久化契约与保存批次,
//   做成叶子模块最省事(与 renderHtmlPreference.ts / inputModality.ts 同一套路)。
// - 归 L1(tools/arch-layers.json 的 frontendEntryFiles 已登记):组件(L3)可直接 import,
//   不引入 store → 组件的反向依赖。
import { ref } from 'vue';

export type ThemeMode = 'system' | 'light' | 'dark';

/** 与 web/public/theme-boot.js 的 STORAGE_KEY 必须逐字一致。 */
export const THEME_STORAGE_KEY = 'kedai.theme-mode.v1';

/** 默认跟随系统。改这里必须同时改 theme-boot.js 的 DEFAULT_MODE。 */
export const DEFAULT_THEME_MODE: ThemeMode = 'system';

const DARK_ATTR = 'dark';
const DARK_QUERY = '(prefers-color-scheme: dark)';

function darkQuery(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  try {
    return window.matchMedia(DARK_QUERY);
  } catch {
    return null;
  }
}

function readStored(): ThemeMode {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  } catch {
    /* 隐私模式 / 存储被禁:用默认值 */
  }
  return DEFAULT_THEME_MODE;
}

/** 当前偏好。默认 'system'。 */
export const themeMode = ref<ThemeMode>(readStored());

/** 当前实际是否暗色('system' 下随系统变化)。UI 用它渲染选中态之外的派生显示。 */
export const isDark = ref(false);

/** 系统当前是否偏好暗色(测试可覆盖)。 */
export function systemPrefersDark(): boolean {
  return darkQuery()?.matches ?? false;
}

/** 把偏好解析成「现在到底是不是暗色」。 */
export function resolveDark(mode: ThemeMode): boolean {
  return mode === 'dark' || (mode === 'system' && systemPrefersDark());
}

/**
 * 把当前偏好落到 <html data-theme>。浅色时摘掉属性,回到 :root 的亮色令牌。
 * 同步刷新 isDark,因此任何保存/切换路径都应以它收口。
 */
export function applyTheme(): void {
  const dark = resolveDark(themeMode.value);
  isDark.value = dark;
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (dark) root.setAttribute('data-theme', DARK_ATTR);
  else root.removeAttribute('data-theme');
}

/** 写入偏好并立即生效(持久化失败不影响本次会话)。 */
export function setThemeMode(next: ThemeMode): void {
  themeMode.value = next;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    /* 存不下也不影响本次会话 */
  }
  applyTheme();
}

/**
 * 在 app.mount 之前调用一次;同时接管「跟随系统」时的系统切换。返回卸载函数(测试用)。
 * 模块导入本身无副作用之外的写操作,jsdom 下可安全 import。
 */
export function installTheme(): () => void {
  applyTheme();
  const mq = darkQuery();
  if (!mq || typeof mq.addEventListener !== 'function') return () => {};
  const onChange = (): void => {
    if (themeMode.value === 'system') applyTheme();
  };
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}
