// 夜间模式:主题偏好、Mode Resolver 映射桥与主题系统并轨（NIGHT-1 / R1 并轨版）
//
// 设计边界与并轨约定（2026-10-30 R1）:
// - 本模块充当上游声明式主题注册表 (web/src/theme/registry) 的 Mode Resolver（A 方案包装桥）：
//   - 保留三档模式: 'system' | 'light' | 'dark'
//   - 在 'system' 下动态监听 matchMedia('(prefers-color-scheme: dark)')，自动映射到 registry 的 'dark' / 'default'
//   - 上游 registry 内部 API 保持纯净零侵入
// - 存储键并轨与静默迁移:
//   - 模式偏好记录于 THEME_STORAGE_KEY ('kedai.theme-mode.v1')
//   - 当前激活主题同步落盘至上游 'kedai.theme.v1'
//   - web/public/theme-boot.js 在 <head> 中优先读取并秒级拦截，首屏 100% 防闪白
// - 颜色与令牌全部由 styles/tokens.css 的 :root[data-theme='dark'] 决定。

import { ref } from 'vue';
import {
  themeRegistry,
  THEME_STORAGE_KEY as REGISTRY_STORAGE_KEY,
  listThemes,
  getActiveThemeId,
  preloadTheme,
  subscribeThemes,
  installThemeApi,
  initTheme,
  announceUiReady,
} from './theme/registry';

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
    // 静默迁移检查：如果仅存在上游 kedai.theme.v1
    const regRaw = localStorage.getItem(REGISTRY_STORAGE_KEY);
    if (regRaw === 'dark') return 'dark';
    if (regRaw === 'default') return 'light';
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
 * 把当前偏好通过 Registry 映射桥生效并落到 <html data-theme>。
 * 浅色时摘掉属性回到 :root 亮色令牌，深色时挂载 data-theme="dark"。
 * 同步刷新 isDark，并持久化到双键中。
 */
export function applyTheme(): void {
  const dark = resolveDark(themeMode.value);
  isDark.value = dark;
  const targetTheme = dark ? 'dark' : 'default';

  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    // 同步调用 registry 应用主题
    void themeRegistry.apply(targetTheme, { persist: true });
    if (dark) {
      root.setAttribute('data-theme', DARK_ATTR);
    } else {
      // 保持浅色时无 data-theme 属性，对齐既有基线与测试断言
      root.removeAttribute('data-theme');
    }
  }

  // 同步两份存储键
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(REGISTRY_STORAGE_KEY, targetTheme);
    }
  } catch {
    /* 忽略存储异常 */
  }
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
 * 在 app.mount 之前调用一次；同时接管「跟随系统」时的系统外观切换。返回卸载函数（测试用）。
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

// 导出上游主题注册表相关 API，使上游生态无缝调用
export {
  themeRegistry,
  listThemes,
  getActiveThemeId,
  preloadTheme,
  subscribeThemes,
  installThemeApi,
  initTheme,
  announceUiReady,
};
