<script setup lang="ts">
// ConfirmDialog.vue — 应用内异步确认/提示对话框（2026-10-30 对话框结构性修复）
//
// 为什么要它（背景见 composables/useConfirm.ts 头注释）：
//   桌面端 Tauri 把 window.confirm/alert 覆写成异步 IPC，而 WebView2 里没有可回退的
//   同步原生方法——裸调用直接 ReferenceError。IPC 无法伪造同步阻塞，故改为应用内对话框，
//   调用点用 await 结算。外观与其他弹窗同源，不再是 Windows MessageBox。
//
// 结构约定：
//   · 队列与结算逻辑全在 composables/useConfirm.ts，本组件**只做渲染**；
//   · 开关 `confirmDialogOpen` 由本组件的 watch 跟随队首是否存在来同步，
//     故调用方不需要手动开关弹窗，只 await confirmAction(...)；
//   · 取消路径（遮罩点击 / ✕ / Android 返回键）= 按 false 结算，绝不留下未结算 Promise；
//   · 样式只用既有 .sv-modal/.sv-btn 与 :root token，不往全局样式表加类（MAINTENANCE D-5）。
import { computed, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useAppStore } from '../store';
import { pendingConfirm, settleConfirm } from '../composables/useConfirm';

const store = useAppStore();
const { confirmDialogOpen } = storeToRefs(store);

/** 队首请求（无请求时组件不该被渲染，这里再守一道）。 */
const request = computed(() => pendingConfirm.value);

/** 是否为「只有确认按钮」的提示模式（alertAction 用：cancelLabel 为空串）。 */
const isNotice = computed(() => !request.value?.cancelLabel);

/** 危险动作（删除类）：确认按钮走 danger 配色。 */
const isDanger = computed(() => !!request.value?.danger);

// 队首出现 → 打开弹窗；队首清空 → 关闭弹窗。
// 放在 watch 而不是调用方，是为了让「入队」这一个动作同时完成展示，调用方只 await。
watch(
  () => pendingConfirm.value,
  (current) => {
    confirmDialogOpen.value = !!current;
    // 队首被结算走后，若还有排队请求，attr 保持打开（上面的赋值已处理：current 非空即 true）
  },
  { immediate: true },
);

/**
 * 反向同步：开关被**外部**关掉时（Android 返回键的 MODAL_FLAGS 逆序循环、
 * 或任何直接置 false 的路径），必须把队首按「取消」结算，否则调用方的 await 永远挂起。
 * 这是「flag 与 Promise 双源」之间唯一的桥，漏了它会静默泄漏未结算 Promise。
 * 注意 : 结算会出队 → pendingConfirm 变 null → 上面的 watch 把 flag 再置 false（无害幂等）。
 */
watch(
  () => confirmDialogOpen.value,
  (open) => {
    if (!open && pendingConfirm.value) settleConfirm(false);
  },
);

/** 确认：按 true 结算（队列推进到下一个请求）。 */
function accept(): void {
  settleConfirm(true);
}

/** 取消/关闭：按 false 结算。 */
function cancel(): void {
  settleConfirm(false);
}
</script>

<template>
  <div v-if="request" class="sv-modal-mask" @click.self="cancel">
    <div class="sv-modal confirm-modal" role="dialog" aria-modal="true">
      <div class="sv-modal-head">
        <h2 class="sv-head-title">
          <span class="sv-supreme" :class="isDanger ? 'red' : 'blue'" />
          {{ isNotice ? '提示' : '确认操作' }}
        </h2>
        <button class="sv-btn ghost sv-btn-square" title="关闭" @click="cancel">✕</button>
      </div>

      <div class="sv-modal-body">
        <!-- 正文按 pre-line 渲染：调用方文案里的换行是刻意断行，压成一行会读不清 -->
        <p class="confirm-message">{{ request.message }}</p>
      </div>

      <div class="sv-modal-foot confirm-foot">
        <button v-if="!isNotice" class="sv-btn ghost" @click="cancel">
          {{ request.cancelLabel }}
        </button>
        <button class="sv-btn" :class="isDanger ? 'danger' : 'primary'" @click="accept">
          {{ request.confirmLabel }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 比默认 sm(480px)略窄：确认文案通常两三行，窄一点眼睛扫得更快 */
.confirm-modal {
  max-width: 460px;
}

.sv-head-title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

/* 正文保留调用方换行（删除类文案常写「后果」在第二行），并保持字重可读 */
.confirm-message {
  margin: 0;
  color: var(--sv-ink);
  font-size: 14px;
  line-height: 1.65;
  white-space: pre-line;
}

.confirm-foot {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}
</style>
