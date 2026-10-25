<script setup lang="ts">
// 位置0 尾部小节(从 PromptManager.vue 拆出,2026-10-25 B5):Dvar 留位说明 /
// 预设尾部提示词 / 反思建议补充。四个字段全部 v-model 双向绑定,组件本身无状态。
const presetTailPrompt = defineModel<string>('presetTailPrompt', { required: true });
const presetTailRole = defineModel<string>('presetTailRole', { required: true });
const reflectAdvicePrompt = defineModel<string>('reflectAdvicePrompt', { required: true });
const reflectAdviceRole = defineModel<string>('reflectAdviceRole', { required: true });
</script>

<template>
<!-- 位置0 尾部 -->
<div class="sv-field">
  <div class="sv-field-label"><span class="sv-supreme green" /> 位置0 · 尾部</div>
  <div class="sv-stack">
    <div class="pm-summary pm-disabled">
      Dvar 变量提示词 — 即将上线(本次仅留位;届时变量状态将以尾部块注入)
    </div>
    <div class="sv-inp-row">
      <label class="sv-inp-tag">预设尾部</label>
      <button
        class="sv-btn ghost"
        :class="{ 'sv-btn-on': presetTailPrompt.trim() !== '' }"
        @click="presetTailPrompt = presetTailPrompt.trim() ? '' : '以上是当前世界的补充设定,请结合以上全部内容继续。'"
      >
        {{ presetTailPrompt.trim() ? '已启用' : '已关闭' }}
      </button>
      <select v-model="presetTailRole" class="sv-select" title="注入角色:角色 = 追加为独立角色消息,用户 = 并入最新用户消息尾部">
        <option value="user">用户</option>
        <option value="assistant">角色</option>
      </select>
    </div>
    <textarea
      v-model="presetTailPrompt"
      rows="3"
      class="sv-input"
      placeholder="复杂模式预设尾部提示词:追加到最新用户消息尾部(位置1 激发之后)。支持酒馆宏。"
      spellcheck="false"
    />
    <div class="sv-inp-row">
      <label class="sv-inp-tag">反思建议</label>
      <button
        class="sv-btn ghost"
        :class="{ 'sv-btn-on': reflectAdvicePrompt.trim() !== '' }"
        @click="reflectAdvicePrompt = reflectAdvicePrompt.trim() ? '' : '修正后请继续保持角色设定与世界观一致。'"
      >
        {{ reflectAdvicePrompt.trim() ? '含补充' : '无补充' }}
      </button>
      <select v-model="reflectAdviceRole" class="sv-select" title="注入角色:角色 = 追加为独立角色消息,用户 = 并入最新用户消息尾部">
        <option value="user">用户</option>
        <option value="assistant">角色</option>
      </select>
    </div>
    <div class="pm-summary pm-disabled">
      反思未通过且放弃重试时,引擎自动生成本次改进建议(≤200 token,内容随失败原因变化),
      注入在位置1 激发之后、预设尾部之前 —— 不再位于最末尾,主体建议无需手填。
    </div>
    <textarea
      v-model="reflectAdvicePrompt"
      rows="2"
      class="sv-input"
      placeholder="可选补充说明:附加在自动生成的改进建议之后(留空 = 仅自动建议)。"
      spellcheck="false"
    />
    <p class="sv-note">自上而下依次注入:位置1 激发 → 反思反馈(仅反思失败时自动注入)→ 预设尾部。</p>
  </div>
</div>
</template>
