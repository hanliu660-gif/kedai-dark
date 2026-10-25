/**
 * 主题偏好（跟随系统 / 浅色 / 深色）。
 *
 * 上游没有任何主题机制，这是本地分支新增的。
 *
 * 设计约束（改之前先读）：
 * - 这里只负责决定 <html data-theme> 挂不挂；具体颜色全部由
 *   style.css 末尾的 `:root[data-theme='dark']` 覆写 --sv-* 令牌决定。
 *   所以不要在这里写任何颜色。
 * - 首屏防闪另有一个独立的 `web/public/theme-boot.js` 在 <head> 里同步跑
 *   （全站 CSP 是 script-src 'self'，内联脚本会被静默拦掉）。
 *   **两处的默认值必须一致**，否则启动时会闪一帧浅色。
 * - 刻意不放进 pinia store：主题是纯展示偏好，不需要进测试/持久化契约，
 *   做成叶子模块最省事（和 renderHtmlPreference.ts 一个套路）。
 */
import { ref } from 'vue';
import { isAndroidTauri } from './platform';

export type ThemeMode = 'system' | 'light' | 'dark';

export const THEME_STORAGE_KEY = 'kedai.theme.v1';

/** 默认暗色。改成 false 时，必须同时改 `web/public/theme-boot.js` 里的默认值。 */
export const DARK_BY_DEFAULT = true;

const FALLBACK: ThemeMode = DARK_BY_DEFAULT ? 'dark' : 'system';

const darkQuery =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;

function readStored(): ThemeMode {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  } catch {
    /* 隐私模式 / 存储被禁：用默认值 */
  }
  return FALLBACK;
}

export const themeMode = ref<ThemeMode>(readStored());

/** 当前是否处于暗色（跟随系统时会随系统变化）。 */
export const isDark = ref(false);

/** 把当前偏好落到 <html data-theme>。浅色时摘掉属性，回到 :root 的亮色令牌。 */
export function applyTheme(): void {
  const dark =
    themeMode.value === 'dark' ||
    (themeMode.value === 'system' && !!darkQuery && darkQuery.matches);
  isDark.value = dark;
  const root = document.documentElement;
  if (dark) root.setAttribute('data-theme', 'dark');
  else root.removeAttribute('data-theme');
  syncAndroidSystemBars(dark);
}

/**
 * 把明暗同步给 Android 原生壳（状态栏/导航栏图标 + edge-to-edge 留白区底色）。
 *
 * 为什么 Web 侧够不到：targetSdk 36 强制 edge-to-edge 后，状态栏与手势条下面那圈
 * 是 MainActivity 给内容根视图加的 insets padding，画的是原生视图背景，CSS 改不动。
 * 不同步的后果是真机截图确认过的「应用全黑、上下两条浅粉边」。
 *
 * 走**事件**而不是自定义命令：remote origin 下 Tauri 会对自定义命令做 ACL 校验并拒绝
 * （同 useExternalLinks.ts / genSettings.ts 的 openExternal、shizuku-request）。
 * 非 Android 环境直接跳过，不发 IPC。
 */
function syncAndroidSystemBars(dark: boolean): void {
  if (!isAndroidTauri) return;
  void (async () => {
    try {
      const { emit } = await import('@tauri-apps/api/event');
      await emit('kedai://set-system-bars', { mode: dark ? 'dark' : 'light' });
    } catch (e) {
      console.warn('[kedai] 同步系统栏配色失败', e);
    }
  })();
}

export function setThemeMode(next: ThemeMode): void {
  themeMode.value = next;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    /* 存不下也不影响本次会话 */
  }
  applyTheme();
}

/** 在 app.mount 之前调用一次；同时接管「跟随系统」时的系统切换。 */
export function initTheme(): void {
  applyTheme();
  if (darkQuery && typeof darkQuery.addEventListener === 'function') {
    darkQuery.addEventListener('change', () => {
      if (themeMode.value === 'system') applyTheme();
    });
  }
}
