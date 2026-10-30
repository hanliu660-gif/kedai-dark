// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import ConfirmDialog from './ConfirmDialog.vue';
import { useAppStore } from '../store';
import { clearConfirmQueue, confirmAction, confirmQueueSize, pendingConfirm } from '../composables/useConfirm';

/**
 * ConfirmDialog 组件测试（2026-10-30 对话框结构性修复）
 *
 * 本组件是「应用内 confirm/alert」的渲染层，逻辑全在 composables/useConfirm。
 * 这里锁定四条最关键的契约：
 *  ① 有请求才渲染，无请求不渲染；
 *  ② 确认按钮 → settleConfirm(true)，取消/✕/遮罩 → settleConfirm(false)；
 *  ③ 提示模式（cancelLabel 为空）只渲染一个按钮；
 *  ④ **开关被外部关闭时必须按取消结算**（Android 返回键走 MODAL_FLAGS 直接置 false，
 *     不做反向同步就会留下永远挂起的 Promise）。
 */
describe('ConfirmDialog', () => {
  beforeEach(() => {
    clearConfirmQueue();
    setActivePinia(createPinia());
    vi.restoreAllMocks();
    // 强制走应用内对话框路径（jsdom 默认有同步原生 confirm）
    vi.stubGlobal('confirm', async () => true);
    vi.stubGlobal('alert', async () => undefined);
  });

  function mountDialog() {
    const store = useAppStore();
    return { store, wrapper: mount(ConfirmDialog, { global: { plugins: [] } }) };
  }

  it('无待确认请求时不渲染', () => {
    const { wrapper } = mountDialog();
    expect(wrapper.find('.sv-modal-mask').exists()).toBe(false);
  });

  it('有请求时渲染正文与两个按钮，点击确认结算为 true', async () => {
    const { wrapper } = mountDialog();
    const p = confirmAction('确定删除?', { danger: true, confirmLabel: '删除', cancelLabel: '取消' });
    await wrapper.vm.$nextTick();

    expect(wrapper.find('.sv-modal-mask').exists()).toBe(true);
    expect(wrapper.find('.confirm-message').text()).toBe('确定删除?');
    // 危险动作走 danger 配色
    expect(wrapper.find('.confirm-foot .sv-btn.danger').exists()).toBe(true);

    await wrapper.find('.confirm-foot .sv-btn.danger').trigger('click');
    expect(await p).toBe(true);
    expect(confirmQueueSize.value).toBe(0);
  });

  it('点取消按钮结算为 false', async () => {
    const { wrapper } = mountDialog();
    const p = confirmAction('确定?');
    await wrapper.vm.$nextTick();
    await wrapper.find('.confirm-foot .sv-btn.ghost').trigger('click');
    expect(await p).toBe(false);
  });

  it('点 ✕ 结算为 false', async () => {
    const { wrapper } = mountDialog();
    const p = confirmAction('确定?');
    await wrapper.vm.$nextTick();
    await wrapper.find('.sv-modal-head .sv-btn-square').trigger('click');
    expect(await p).toBe(false);
  });

  it('提示模式(无 cancelLabel)只渲染一个按钮', async () => {
    const { wrapper } = mountDialog();
    void confirmAction('仅提示', { cancelLabel: '' });
    await wrapper.vm.$nextTick();
    // 提示模式确认按钮走 primary
    expect(wrapper.find('.confirm-foot .sv-btn.primary').exists()).toBe(true);
    // 不渲染取消按钮
    expect(wrapper.find('.confirm-foot .sv-btn.ghost').exists()).toBe(false);
  });

  it('开关被外部关闭时按取消结算(Android 返回键路径,防止 Promise 挂起)', async () => {
    const { store, wrapper } = mountDialog();
    const p = confirmAction('确定?');
    await wrapper.vm.$nextTick();
    expect(pendingConfirm.value).not.toBeNull();

    // 模拟 App.vue 的 MODAL_FLAGS 逆序循环:直接置 false
    store.confirmDialogOpen = false;
    await wrapper.vm.$nextTick();

    expect(await p).toBe(false);
    expect(confirmQueueSize.value).toBe(0);
  });

  it('队列串行推进:结算第一个后自动展示第二个', async () => {
    const { wrapper } = mountDialog();
    const p1 = confirmAction('第一个');
    const p2 = confirmAction('第二个');
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.confirm-message').text()).toBe('第一个');

    await wrapper.find('.confirm-foot .sv-btn.primary').trigger('click');
    expect(await p1).toBe(true);
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.confirm-message').text()).toBe('第二个');

    await wrapper.find('.confirm-foot .sv-btn.primary').trigger('click');
    expect(await p2).toBe(true);
  });
});
