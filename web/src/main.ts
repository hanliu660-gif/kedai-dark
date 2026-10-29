// 前端入口
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { restoreNativeDialogs } from './nativeDialogs';
import { installGlobalErrorHandlers } from './globalErrorHandlers';
import { installInputModality } from './inputModality';
import { installTheme } from './theme';
import { useUiPrefsStore } from './stores/uiPrefs';
// 展示字体(拉丁字标/数字用,本地打包离线可用)
import '@fontsource/archivo-black';
import './style.css';

// 对话框原生还原:移除 Tauri 对话框插件注入的异步 IPC 覆写,确保 confirm/alert 保持原生同步阻塞语义并免遭 ACL 拦截
restoreNativeDialogs();

const app = createApp(App);
const pinia = createPinia();
app.use(pinia);

// 夜间模式(NIGHT-1):挂 <html data-theme>。首帧那次已由 index.html 里的 theme-boot.js
// 同步做过(防闪),这里负责「运行期以 localStorage 为准重算一次 + 订阅系统偏好变化」。
// 顺序必须在 mount 之前:否则首屏渲染时 isDark 还是初值 false。
installTheme();

// 输入模态标记(UIP-12):html[data-input-mode] 供 styles/panels.css 收窄 select 焦点样式;
// 尽早安装(首帧即有标记能力),无标记时行为与现状逐字一致。
installInputModality();

// 全局错误兜底(计划批次 5.1):必须在 mount 之前注册,否则首屏渲染期的异常会漏掉。
// 经 useUiPrefsStore(pinia) 显式取 store——main.ts 里还没有活跃的 pinia 实例上下文,
// 不能直接调 useUiPrefsStore()。异常只写内存态横幅,不落库、不含聊天正文。
const uiPrefs = useUiPrefsStore(pinia);
installGlobalErrorHandlers({
  app,
  onError: (message) => {
    uiPrefs.globalError = message;
  },
});

app.mount('#app');
