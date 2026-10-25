<script setup lang="ts">
// 位置4 预设楼层编辑器(从 PromptManager.vue 拆出,2026-10-25 B5)。
// 楼层数据用 v-model 双向绑定;拖拽/↑↓ 排序与「编辑中」状态是本组件私有交互态。
import { ref } from 'vue';
import * as api from '../../api';

const floors = defineModel<api.PromptFloor[]>({ required: true });
/** 当前是否简单模式(仅用于提示文案:简单模式不注入楼层) */
const props = defineProps<{ simpleMode: boolean }>();

const FLOOR_ROLE_LABELS: Record<api.FloorRole, string> = {
  system: '系统提示词',
  user: '用户',
  assistant: '角色',
};

const editingFloorId = ref<string | null>(null);
const dragFloorId = ref<string | null>(null);

// ===== 位置4 楼层排序 =====
function moveFloor(id: string, dir: -1 | 1): void {
  const fs = floors.value;
  const idx = fs.findIndex((f) => f.id === id);
  const to = idx + dir;
  if (idx < 0 || to < 0 || to >= fs.length) return;
  [fs[idx], fs[to]] = [fs[to], fs[idx]];
  fs.forEach((f, i) => (f.order = i));
}

function addFloor(): void {
  const id = (crypto.randomUUID?.() ?? `f-${Date.now()}`) as string;
  floors.value.push({
    id,
    name: '新楼层',
    content: '',
    role: 'user',
    position: 'system',
    depth: 0,
    enabled: true,
    order: floors.value.length,
  });
  editingFloorId.value = id;
}

function removeFloor(id: string): void {
  floors.value = floors.value.filter((f) => f.id !== id);
  floors.value.forEach((f, i) => (f.order = i));
  if (editingFloorId.value === id) editingFloorId.value = null;
}

function onFloorDragStart(e: DragEvent, id: string): void {
  dragFloorId.value = id;
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
}
function onFloorDragOver(e: DragEvent, id: string): void {
  e.preventDefault();
  if (!dragFloorId.value || dragFloorId.value === id) return;
  const fs = floors.value;
  const from = fs.findIndex((f) => f.id === dragFloorId.value);
  const to = fs.findIndex((f) => f.id === id);
  if (from < 0 || to < 0) return;
  fs.splice(to, 0, fs.splice(from, 1)[0]);
  fs.forEach((f, i) => (f.order = i));
}
function onFloorDrop(e: DragEvent): void {
  e.preventDefault();
  dragFloorId.value = null;
}
function onFloorDragEnd(): void {
  dragFloorId.value = null;
}

</script>

<template>
    <!-- 位置4 预设楼层(始终显示,可拖拽/↑↓ 排序;简单模式下不注入,切到复杂模式生效) -->
    <p class="sv-note">
      楼层按列表顺序注入(系统角色进系统提示词,用户/角色紧随其后);可拖拽或 ↑↓ 排序,消息角色可自由选择。
      <template v-if="props.simpleMode"><b>当前为简单模式,楼层不注入</b>——切到「复杂」即生效。</template>
      <code v-pre>{{setvar::键::值}}</code> 持久化到会话变量,后续楼层可
      <code v-pre>{{getvar::键}}</code> 读取。
    </p>
    <div v-if="!floors.length" class="sv-note inject-empty">尚未添加楼层,点击下方「新增楼层」。</div>
    <div
      v-for="floor in floors"
      :key="floor.id"
      class="floor-row"
      :class="{ dragging: dragFloorId === floor.id }"
      draggable="true"
      @dragstart="onFloorDragStart($event, floor.id)"
      @dragover="onFloorDragOver($event, floor.id)"
      @drop="onFloorDrop"
      @dragend="onFloorDragEnd"
    >
      <span class="floor-grip" title="拖拽排序">⋮⋮</span>
      <button
        class="sv-btn ghost"
        :class="{ 'sv-btn-on': floor.enabled }"
        :title="floor.enabled ? '点击停用' : '点击启用'"
        @click="floor.enabled = !floor.enabled"
      >
        {{ floor.enabled ? '开' : '关' }}
      </button>
      <input v-model="floor.name" type="text" class="sv-input floor-name" placeholder="楼层名称" spellcheck="false" />
      <select v-model="floor.role" class="sv-select floor-select" title="消息角色">
        <option v-for="(label, val) in FLOOR_ROLE_LABELS" :key="val" :value="val">{{ label }}</option>
      </select>
      <div class="floor-actions">
        <button class="sv-btn ghost sv-btn-square" title="上移" @click="moveFloor(floor.id, -1)">↑</button>
        <button class="sv-btn ghost sv-btn-square" title="下移" @click="moveFloor(floor.id, 1)">↓</button>
        <button
          class="sv-btn ghost sv-btn-square"
          :title="editingFloorId === floor.id ? '收起编辑' : '编辑内容'"
          @click="editingFloorId = editingFloorId === floor.id ? null : floor.id"
        >
          ✎
        </button>
        <button class="sv-btn danger sv-btn-square" title="删除楼层" @click="removeFloor(floor.id)">✕</button>
      </div>
      <textarea
        v-if="editingFloorId === floor.id"
        v-model="floor.content"
        rows="5"
        class="sv-input floor-content"
        placeholder="楼层内容,支持酒馆宏。例如:{{char}}内心提醒:{{setvar::场景::酒馆}}今晚在{{getvar::场景}}见面。"
        spellcheck="false"
      />
    </div>
    <div class="sv-btn-row">
      <button class="sv-btn ghost sv-btn-fill" @click="addFloor">＋ 新增楼层</button>
    </div>
</template>
