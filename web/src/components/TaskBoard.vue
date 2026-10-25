<script setup lang="ts">
// 任务工作台外壳:顶栏(标题 / 模型 / Agent 面板开关)+ 任务详情区。
// 详情区已拆到 ./task/TaskBoardDetail.vue(2026-10-25 B5),本文件只做布局与顶栏。
import { storeToRefs } from 'pinia';
import { useAppStore } from '../store';
import TaskBoardDetail from './task/TaskBoardDetail.vue';

const store = useAppStore();
const { model } = storeToRefs(store);
</script>

<template>
  <section class="flex min-h-0 min-w-0 flex-1 flex-col">
    <!-- 顶栏 -->
    <header class="sv-topbar">
      <span class="flex items-center gap-2">
        <span class="sv-supreme md" aria-hidden="true" />
        <span class="sv-topbar-title">任务工作台</span>
        <span v-if="model" class="sv-topbar-sub">{{ model }}</span>
      </span>

      <span class="sv-topbar-right">
        <!-- Agent 面板开关(面板合并后原「调用情况」独立拨杆收编:与聊天顶栏同一入口,两模式共用)
             sv-topbar-agent:移动端隐藏,该入口已由底部导航「AGENT」承载 -->
        <div class="sv-topbar-group sv-topbar-agent">
          <button
            type="button"
            class="sv-render-toggle-v2"
            :aria-pressed="store.agentPanelOpen"
            :title="store.agentPanelOpen ? 'Agent 面板已开启(含调用情况)' : 'Agent 面板已关闭(含调用情况)'"
            @click="store.toggleAgentPanel()"
          >
            <span class="toggle-track" :class="{ on: store.agentPanelOpen }">
              <span class="toggle-thumb" />
            </span>
            <span class="toggle-label">AGENT</span>
          </button>
        </div>
      </span>
    </header>
    <!-- 主体:任务详情(计划步骤 / 子任务 / 成果 / 追加指令)已拆到子组件 -->
    <TaskBoardDetail />
  </section>
</template>
