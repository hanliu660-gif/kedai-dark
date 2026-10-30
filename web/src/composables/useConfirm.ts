// useConfirm.ts — 异步确认/提示的统一入口（2026-10-30 对话框结构性修复）
//
// 为什么要这个模块（先读再改）：
//   桌面端（Tauri/WebView2）里 `tauri-plugin-dialog` 会在页面加载前注入
//   `init-iife.js`，把 `window.confirm`/`window.alert` 覆写成**异步 IPC**：
//       window.confirm = async (msg) => await invoke('plugin:dialog|confirm', ...)
//   而原生的同步阻塞 `confirm` 在 WebView2 里**不存在于 Window.prototype**（实测：
//   浏览器里它是 window 的**自有属性**，`Window.prototype` 上没有）。于是：
//     · 覆写成 async ⇒ `if (confirm(...))` 把 Promise 当真值，**未等用户确认就执行**；
//     · 想靠 `delete window.confirm` 退回原型 ⇒ 原型上根本没有，属性直接变 undefined，
//       任何**裸 `confirm(...)`** 抛 `ReferenceError: confirm is not defined`（实机复现）。
//   结论：IPC 天生异步，**无法伪造同步阻塞语义**，只能在调用点改成异步。
//
// 本模块的做法：
//   · 有可用的**同步**原生 confirm 时（浏览器/开发服务器），直接沿用原生语义（零成本）；
//   · 同步原生不可用时（异步覆写 / 属性被删掉），入队并交给 `ConfirmDialog` 渲染，
//     返回 Promise，调用方 `await` 即可。
//   这样同一份调用点代码在浏览器与 Tauri 下都成立，且桌面端外观统一（不再是
//   Windows MessageBox）。
//
// 结构约定（改这里前必读）：
//   · 队列是**模块级单例**，同一时刻只渲染一个对话框，`resolve` 一次即出队；
//   · 对话框组件由 `modals.ts` 注册表 + `uiPrefs.confirmDialogOpen` 驱动，与其它弹窗
//     同一套挂载/返回键/懒加载机制，不要在组件里自己 new 一个模态；
//   · 取消/关闭（含 Android 返回键）一律按 `false` 结算，避免调用方永远挂起。

import { computed, readonly, ref } from 'vue';

/** 一个待结算的确认请求。 */
export interface ConfirmRequest {
  /** 稳定 id（v-for/测试用，不入 DOM 展示） */
  readonly id: number;
  /** 询问正文（可含换行，对话框按 pre-line 渲染） */
  readonly message: string;
  /** 确认按钮文案（缺省「确定」） */
  readonly confirmLabel: string;
  /** 取消按钮文案（缺省「取消」；传空串表示只有确认按钮） */
  readonly cancelLabel: string;
  /** 危险动作（删除类）：确认按钮走危险配色 */
  readonly danger: boolean;
  /** 结算（true=确认，false=取消/关闭）。重复调用第二次起无效。 */
  readonly resolve: (ok: boolean) => void;
}

/** 后续请求的 id 分配器。 */
let nextId = 1;

/** 待结算队列（只渲染队首，其余排队）。 */
const queue = ref<ConfirmRequest[]>([]);

/** 队首请求（对话框渲染的唯一数据源）。 */
export const pendingConfirm = readonly(computed(() => queue.value[0] ?? null));

/** 队列长度（测试与「还有 N 条待确认」提示用）。 */
export const confirmQueueSize = readonly(computed(() => queue.value.length));

/**
 * 判断当前环境的原生 confirm 是否为**同步**可用的（浏览器 / 非 Tauri）。
 * 异步覆写的特征是「函数存在但返回 Promise」——不能只看 typeof。
 */
export function hasSyncNativeConfirm(): boolean {
  if (typeof window === 'undefined' || typeof window.confirm !== 'function') return false;
  try {
    // 不实际弹窗：只探测函数是否被标注 async。原生 confirm 是 native code，
    // `constructor.name` 为 'Function'；被 async 覆写的是 'AsyncFunction'。
    const kind = (window.confirm as { constructor?: { name?: string } }).constructor?.name;
    return kind !== 'AsyncFunction';
  } catch {
    return false;
  }
}

/** 入队一个确认请求并返回其结算 Promise。 */
function enqueue(opts: {
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const request: ConfirmRequest = {
      id: nextId++,
      message: String(opts.message ?? ''),
      confirmLabel: opts.confirmLabel ?? '确定',
      cancelLabel: opts.cancelLabel ?? '取消',
      danger: opts.danger ?? false,
      resolve: (ok: boolean) => {
        if (settled) return;
        settled = true;
        // 出队：只移除自己（正常情况下必是队首）
        queue.value = queue.value.filter((r) => r.id !== request.id);
        resolve(ok);
      },
    };
    queue.value = [...queue.value, request];
  });
}

/**
 * 确认询问（替代 `confirm(msg)`）。
 *
 * 返回 `true` 表示用户点了确认；`false` 表示取消/关闭。
 * 浏览器下若原生同步 confirm 可用，会**直接同步**走原生（保持既有交互与既有测试习惯）；
 * 桌面端（异步覆写）下走应用内对话框。
 */
export function confirmAction(
  message: string,
  opts: { confirmLabel?: string; cancelLabel?: string; danger?: boolean } = {},
): Promise<boolean> {
  // 同步原生可用：沿用浏览器原生（含 jsdom 测试环境），行为与改造前一模一样
  if (hasSyncNativeConfirm()) {
    try {
      return Promise.resolve(!!window.confirm(message));
    } catch {
      /* 落到底下的应用内对话框 */
    }
  }
  return enqueue({ message, ...opts });
}

/**
 * 提示（替代 `alert(msg)`）。
 *
 * 原生同步 alert 可用时直接弹出；否则走应用内对话框的「只有一个按钮」形态。
 * 注意：**没有返回值**——调用方不需要等待用户看完才继续（与原 alert 一致）。
 */
export function alertAction(message: string, opts: { confirmLabel?: string } = {}): Promise<void> {
  const text = String(message ?? '');
  if (typeof window !== 'undefined') {
    const kind = (window.alert as { constructor?: { name?: string } } | undefined)?.constructor?.name;
    if (typeof window.alert === 'function' && kind !== 'AsyncFunction') {
      try {
        window.alert(text);
        return Promise.resolve();
      } catch {
        /* 落到底下的应用内对话框 */
      }
    }
  }
  return enqueue({ message: text, confirmLabel: opts.confirmLabel ?? '好的', cancelLabel: '' }).then(
    () => undefined,
  );
}

/** 结算队首请求（对话框按钮/返回键调用）。幂等。 */
export function settleConfirm(ok: boolean): void {
  queue.value[0]?.resolve(ok);
}

/** 清空队列（仅在会话/环境重置时用；全部按 false 结算，避免调用方挂起）。 */
export function clearConfirmQueue(): void {
  const drained = queue.value;
  queue.value = [];
  for (const r of drained) r.resolve(false);
}
