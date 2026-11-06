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
import { DEFAULT_PALETTE_ID, isPaletteId, paletteById } from './theme/palettes';

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

/* ===== 配色方案(2026-11-03):与明暗模式正交的第二维 ===== */

/** 配色偏好存储键。与 theme-boot.js 的 PALETTE_KEY 必须逐字一致。 */
export const PALETTE_STORAGE_KEY = 'kedai.palette.v1';

function readStoredPalette(): string {
  try {
    const raw = localStorage.getItem(PALETTE_STORAGE_KEY);
    return isPaletteId(raw) ? raw : DEFAULT_PALETTE_ID;
  } catch {
    return DEFAULT_PALETTE_ID;
  }
}

/** 当前配色 id(默认 'default' = 构成主义纸面,不挂 data-palette)。 */
export const paletteId = ref<string>(readStoredPalette());

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

  // 2b. 配色:默认配色不挂属性(走 tokens.css 基底),其余挂 data-palette 由 palettes.css 覆盖
  applyPaletteAttr(root);

  // 3. 异步 Promise 结算后再做一次单一所有权收拢，彻底消除任何晚到微任务的覆盖竞态
  return promise.then((res) => {
    if (token === currentApplyToken) {
      if (!resolveDark(themeMode.value)) {
        root.removeAttribute('data-theme');
      } else {
        root.setAttribute('data-theme', DARK_ATTR);
      }
      applyPaletteAttr(root);
    }
    return res;
  });
}

/** 把 paletteId 落到 <html data-palette>;默认配色摘除属性。
 *  darkOnly 配色(纯黑)在浅色档下不挂载——它在浅色下没有定义,挂上去只会露出基底粉色,
 *  反而不如老实回落默认配色。切换动作由设置页负责强制到深色。 */
function applyPaletteAttr(root: HTMLElement): void {
  const def = paletteById(paletteId.value);
  const usable = def.id !== DEFAULT_PALETTE_ID && (!def.darkOnly || isDark.value);
  if (usable) {
    root.setAttribute('data-palette', def.id);
  } else {
    root.removeAttribute('data-palette');
  }
}

/* ===== 「选纯黑时自动切深色」的记忆(2026-11-03) =====
 * 纯黑只有深色档,所以浅色下选它必须先把明暗档顶到深色。问题是那次切换是**替用户做的**,
 * 如果不记住,用户再点任何配色按钮都会停在深色里,看起来就是"点了没反应、回不去"。
 * 记在 localStorage 而不是模块变量:刷新之后仍要能一键退出纯黑。
 */
export const AUTO_DARK_MODE_KEY = 'kedai.palette-autodark.v1';

function readAutoDarkMode(): ThemeMode | null {
  try {
    const raw = localStorage.getItem(AUTO_DARK_MODE_KEY);
    return raw === 'light' || raw === 'system' ? raw : null;
  } catch {
    return null;
  }
}

let autoDarkMode: ThemeMode | null = readAutoDarkMode();

/** 用户显式选过明暗档后,「自动切深色」的记忆作废——深色是他自己要的,不该被还原。 */
export function clearAutoDarkMode(): void {
  autoDarkMode = null;
  try {
    localStorage.removeItem(AUTO_DARK_MODE_KEY);
  } catch {
    /* 存不下也不影响本次会话 */
  }
}

function rememberAutoDarkMode(mode: ThemeMode): void {
  autoDarkMode = mode;
  try {
    localStorage.setItem(AUTO_DARK_MODE_KEY, mode);
  } catch {
    /* 存不下也不影响本次会话 */
  }
}

/**
 * 选配色(设置页「配色」行的唯一入口)。
 *
 * 两条不变量:
 * 1. 选 darkOnly 配色(纯黑):浅色下先切深色,并记住原来的明暗档;
 * 2. 从纯黑切到任何普通配色:**把那次自动切的深色还原回去**,否则用户被困在深色里。
 * 若深色是用户自己选的(记忆已被 clearAutoDarkMode 清空),则保持深色,只换配色。
 */
export function selectPalette(next: string): void {
  const id = isPaletteId(next) ? next : DEFAULT_PALETTE_ID;
  if (paletteById(id).darkOnly) {
    if (!resolveDark(themeMode.value)) {
      rememberAutoDarkMode(themeMode.value);
      setThemeMode('dark');
    }
    setPalette(id);
    return;
  }
  const restore = paletteById(paletteId.value).darkOnly ? autoDarkMode : null;
  clearAutoDarkMode();
  setPalette(id);
  if (restore) setThemeMode(restore);
}

/** 切换配色并立即生效(与明暗模式互不影响;持久化失败不影响本次会话)。 */
export function setPalette(next: string): void {
  paletteId.value = isPaletteId(next) ? next : DEFAULT_PALETTE_ID;
  try {
    localStorage.setItem(PALETTE_STORAGE_KEY, paletteId.value);
  } catch {
    /* 存不下也不影响本次会话 */
  }
  if (typeof document !== 'undefined') applyPaletteAttr(document.documentElement);
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
