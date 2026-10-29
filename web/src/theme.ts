// 夜间模式:主题偏好、Mode Resolver 映射桥与主题系统并轨（NIGHT-1 / R1/R2 并轨版）
//
// 设计边界与并轨约定（2026-10-30 R1/R2）:
// - 本模块充当上游声明式主题注册表 (web/src/theme/registry) 的 Mode Resolver（A 方案包装桥）：
//   - 保留三档模式: 'system' | 'light' | 'dark'
//   - 在 'system' 下动态监听 matchMedia('(prefers-color-scheme: dark)')，自动映射到 registry 的 'dark' / 'default'
//   - 上游 registry 内部 API 保持纯净零侵入
// - 单一所有权与异步竞态收拢:
//   - applyTheme 采用令牌序列守卫 + 同步锁定 + Promise 结算后最终收拢，确保浅色模式下彻底移除 data-theme 属性，绝不残留 "default"
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

/** 最新一次 applyTheme 的递增序列号，用于在异步结算后丢弃过期的竞态更新 */
let currentApplyToken = 0;

/**
 * 把当前偏好通过 Registry 映射桥生效并落到 <html data-theme>。
 * 单一所有权保证：
 * 1. 同步立即落 DOM（深色为 'dark'，浅色彻底移除属性），保证首帧与单测瞬时一致性；
 * 2. 等待 themeRegistry.apply 结束并在微任务结算后二次断言最终状态，防止乱序写回 "default"；
 * 3. 浅色模式下杜绝任何 "default" 或其它非 dark 字符串残留。
 */
export function applyTheme(): Promise<boolean> {
  const token = ++currentApplyToken;
  const dark = resolveDark(themeMode.value);
  isDark.value = dark;
  const targetTheme = dark ? 'dark' : 'default';

  // 同步两份存储键
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(REGISTRY_STORAGE_KEY, targetTheme);
    }
  } catch {
    /* 忽略存储异常 */
  }

  if (typeof document === 'undefined') return Promise.resolve(true);
  const root = document.documentElement;

  // 1. 调用 registry 切换主题（内部会更新 activeId、通知订阅者并持久化）
  const promise = themeRegistry.apply(targetTheme, { persist: true });

  // 2. 立即接管 DOM 属性单一所有权：深色挂 data-theme="dark"，浅色彻底摘除属性
  if (dark) {
    root.setAttribute('data-theme', DARK_ATTR);
  } else {
    root.removeAttribute('data-theme');
  }

  // 3. 异步 Promise 结算后再做一次单一所有权收拢，彻底消除任何晚到微任务的覆盖竞态
  return promise.then((res) => {
    if (token === currentApplyToken) {
      if (!resolveDark(themeMode.value)) {
        root.removeAttribute('data-theme');
      } else {
        root.setAttribute('data-theme', DARK_ATTR);
      }
    }
    return res;
  });
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
