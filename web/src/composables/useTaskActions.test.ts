import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useAppStore } from '../store';
import { useTaskActions } from './useTaskActions';
import type { TaskRecord } from '../api';
// 2026-10-30 对话框结构性修复：确认/提示改走 useConfirm 的 Promise 化入口，
// 不再走 window.confirm/alert（桌面端 Tauri 覆写后同步语义不可保）。
// 测试按模块级 mock 注入结果，断言对象也随之为这两个 vi.fn。
vi.mock('./useConfirm', () => ({
  confirmAction: vi.fn(() => Promise.resolve(true)),
  alertAction: vi.fn(() => Promise.resolve()),
}));
import { alertAction, confirmAction } from './useConfirm';

const memStorage = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => memStorage.get(k) ?? null,
  setItem: (k: string, v: string) => void memStorage.set(k, String(v)),
  removeItem: (k: string) => void memStorage.delete(k),
  clear: () => memStorage.clear(),
  key: (i: number) => [...memStorage.keys()][i] ?? null,
  get length() { return memStorage.size; },
});

const task: TaskRecord = {
  id: 't1',
  title: '测试任务',
  status: 'pending',
  plan: [],
  result: '',
  error: '',
  created_at: '',
  updated_at: '',
};

describe('useTaskActions（C-2A 删除/执行/停止单一出口）', () => {
  let store: ReturnType<typeof useAppStore>;

  beforeEach(() => {
    memStorage.clear();
    setActivePinia(createPinia());
    store = useAppStore();
    store.currentTaskId = 't1';
    store.runTask = vi.fn().mockResolvedValue(undefined);
    store.stopTask = vi.fn().mockResolvedValue(undefined);
    store.deleteTask = vi.fn().mockResolvedValue(undefined);
    vi.mocked(confirmAction).mockReset().mockResolvedValue(true);
    vi.mocked(alertAction).mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runCurrent / stopCurrent 用当前任务 id 调 store', async () => {
    const { runCurrent, stopCurrent } = useTaskActions();
    await runCurrent();
    await stopCurrent();
    expect(store.runTask).toHaveBeenCalledWith('t1');
    expect(store.stopTask).toHaveBeenCalledWith('t1');
  });

  it('无当前任务时执行/停止不发请求（删除仍按传入任务工作）', async () => {
    store.currentTaskId = null;
    const { runCurrent, stopCurrent, removeTask } = useTaskActions();
    await runCurrent();
    await stopCurrent();
    expect(store.runTask).not.toHaveBeenCalled();
    expect(store.stopTask).not.toHaveBeenCalled();
    await removeTask(task);
    expect(store.deleteTask).toHaveBeenCalledWith('t1');
  });

  it('removeTask 确认后删除；取消确认不发请求', async () => {
    const { removeTask } = useTaskActions();
    await removeTask(task);
    expect(vi.mocked(confirmAction).mock.calls[0]?.[0]).toEqual(expect.stringContaining('测试任务'));
    expect(store.deleteTask).toHaveBeenCalledWith('t1');

    vi.mocked(store.deleteTask).mockClear();
    vi.mocked(confirmAction).mockResolvedValue(false);
    await removeTask(task);
    expect(store.deleteTask).not.toHaveBeenCalled();
  });

  it('失败路径给出中文 alert（不吞错）', async () => {
    store.runTask = vi.fn().mockRejectedValue(new Error('网络错误'));
    store.stopTask = vi.fn().mockRejectedValue(new Error('已结束'));
    store.deleteTask = vi.fn().mockRejectedValue(new Error('不存在'));
    const { runCurrent, stopCurrent, removeTask } = useTaskActions();
    await runCurrent();
    await stopCurrent();
    await removeTask(task);
    expect(alertAction).toHaveBeenCalledWith('执行失败:网络错误');
    expect(alertAction).toHaveBeenCalledWith('停止失败:已结束');
    expect(alertAction).toHaveBeenCalledWith('删除失败:不存在');
  });
});
