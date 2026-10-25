// 会话域动作:列表/新建/切换/历史加载/统计/压缩/清空/导入导出/消息增删改。
// 本模块不依赖其他动作模块(内部调用均为同模块函数),是本 store 的地基层。
import * as api from '../../api';
import { replayMvuVariables } from '../../mvu/mvuStore';
import { saveExportFile } from '../../exportFile';
import { writeLastSessionId } from '../../lastPosition';
import { idleAgent } from '../../sseReducer';
import { useUiPrefsStore } from '../uiPrefs';
import { currentCharacterIdValue } from '../storeBridge';
import type { ChatActions, ChatDeps } from './chatContext';

export function createSessionActions(deps: ChatDeps): Partial<ChatActions> {
  const {
    currentSessionId,
    sessions,
    messages,
    generating,
    agent,
    lastUsage,
    contextTokens,
    mvuVariables,
    sessionTotalTokens,
    globalTotalTokens,
  } = deps.state;

  // ===== 会话管理 =====
  async function loadSessions(characterId: string): Promise<void> {
    sessions.value = await api.listSessions(characterId);
  }

  /** 新建会话并切换过去(后端会注入角色开场白作为首条消息);greetingIndex=0 主开场,1..=备用开场 */
  async function newSession(greetingIndex = 0): Promise<void> {
    const cid = currentCharacterIdValue();
    if (!cid) return;
    const session = await api.createSession(cid, undefined, greetingIndex);
    sessions.value.unshift(session);
    currentSessionId.value = session.id;
    writeLastSessionId(cid, session.id);
    lastUsage.value = null;
    agent.value = idleAgent();
    // 新会话恢复自动展开语义
    useUiPrefsStore().resetAgentPanelAutoSuppress();
    await loadHistory(session.id);
  }

  /** 会话内切换开场:清空当前会话消息后,按 greetingIndex 重新播种开场并刷新历史 */
  async function switchGreeting(greetingIndex: number): Promise<void> {
    const sid = currentSessionId.value;
    if (!sid) return;
    await api.regreetSession(sid, greetingIndex);
    messages.value = [];
    contextTokens.value = 0;
    lastUsage.value = null;
    await loadHistory(sid);
  }

  async function switchSession(id: string): Promise<void> {
    if (generating.value) return;
    currentSessionId.value = id;
    // 新会话恢复自动展开语义(上一会话的「不再自动弹」不跨越会话边界)
    useUiPrefsStore().resetAgentPanelAutoSuppress();
    const cid = currentCharacterIdValue();
    if (cid) writeLastSessionId(cid, id);
    await loadHistory(id);
  }

  async function loadHistory(sessionId: string): Promise<void> {
    try {
      const msgs = await api.fetchHistory(sessionId);
      messages.value = msgs.map((m) => ({ ...m, streaming: false }));
      mvuVariables.value = replayMvuVariables(msgs);
      updateContextTokens(msgs);
      // 加载 Token 累计统计
      void loadTokenTotals(sessionId);
      // 恢复该会话的 Agent 记录(实跑问题 4:此前 agent 纯内存,切会话/重启即丢;
      // 后端 tool_calls 已持久化,这里按会话读回工具调用列表)
      void restoreAgentTrace(sessionId);
    } catch (e) {
      console.error('加载历史失败', e);
      // 历史加载失败必须可见:静默失败 + sendMessage 自动新建会话会把旧会话「藏」起来,
      // 表现为聊天记录丢失
      useUiPrefsStore().dataLoadError = `加载聊天记录失败:${(e as Error).message ?? e}`;
    }
  }

  async function restoreAgentTrace(sessionId: string): Promise<void> {
    try {
      const trace = await api.fetchAgentTrace(sessionId);
      // 会话已切换:迟到的响应不得覆盖当前会话(loadHistory 并发可重入)
      if (currentSessionId.value !== sessionId) return;
      if (!trace || trace.tool_calls.length === 0) {
        agent.value = idleAgent();
        return;
      }
      const base = idleAgent();
      base.phase = trace.state === 'idle' ? 'finished' : trace.state;
      base.toolCalls = trace.tool_calls.map((c) => ({
        name: c.name,
        input: c.input,
        output: c.output,
        status: 'done' as const,
      }));
      agent.value = base;
    } catch {
      // 静默:Agent 记录是辅助展示,失败保持空闲态
    }
  }

  /** 加载 Token 累计统计(会话 + 全局) */
  async function loadTokenTotals(sessionId?: string): Promise<void> {
    try {
      const sid = sessionId ?? currentSessionId.value;
      if (sid) {
        sessionTotalTokens.value = await api.getSessionTotalTokens(sid);
      }
      globalTotalTokens.value = await api.getGlobalTotalTokens();
    } catch {
      /* 忽略 */
    }
  }

  async function updateContextTokens(msgs: Array<{ role: string; content: string }>): Promise<void> {
    try {
      contextTokens.value = await api.countTokens(msgs);
    } catch {
      /* 忽略 */
    }
  }

  // 手动压缩当前会话历史:调用后端摘要,成功后刷新历史展示。
  // 模式为 off 时后端拒绝;历史不足时返回 compacted=false(前端给出对应提示)。
  async function compactCurrentChat(): Promise<{ compacted: boolean }> {
    const sid = currentSessionId.value;
    if (!sid) {
      throw new Error('当前无会话,无法压缩');
    }
    const res = await api.compactChat(sid);
    if (res.compacted) {
      await loadHistory(sid);
    }
    return res;
  }

  // 撤销压缩:清除摘要行恢复完整原文历史,成功后刷新历史展示。
  async function clearCurrentCompaction(): Promise<{ cleared: boolean }> {
    const sid = currentSessionId.value;
    if (!sid) {
      throw new Error('当前无会话,无法恢复');
    }
    const res = await api.clearCompactChat(sid);
    if (res.cleared) {
      await loadHistory(sid);
    }
    return res;
  }

  async function removeMessage(id: number): Promise<void> {
    const sid = currentSessionId.value;
    if (!sid) return;
    if (id > 0) {
      try {
        await api.deleteMessage(sid, id);
      } catch (e) {
        console.warn('删除服务端消息失败(本地仍移除,刷新后以服务端为准)', e);
      }
    }
    messages.value = messages.value.filter((m) => m.id !== id);
  }

  /** 编辑一条消息内容 */
  async function updateMessage(id: number, content: string): Promise<void> {
    const sid = currentSessionId.value;
    if (!sid) return;
    const updated = await api.updateMessage(sid, id, content);
    const idx = messages.value.findIndex((m) => m.id === id);
    if (idx !== -1) {
      messages.value[idx].content = updated.content;
      messages.value[idx].extra = updated.extra;
      // 清除旧的宏展开显示文本:PUT 端点不重新生成 content_display,
      // 保留旧值会导致气泡继续显示编辑前的文本(下次 loadHistory 才会刷新)
      delete messages.value[idx].content_display;
    }
  }

  /** 清空当前会话 */
  async function clearCurrentChat(): Promise<void> {
    const sid = currentSessionId.value;
    if (!sid) return;
    await api.clearMessages(sid);
    messages.value = [];
    contextTokens.value = 0;
    // 清空即回到空会话状态:恢复自动展开语义
    useUiPrefsStore().resetAgentPanelAutoSuppress();
  }

  async function exportCurrentChat(): Promise<string | null> {
    const sid = currentSessionId.value;
    if (!sid) throw new Error('没有可导出的会话');
    const data = await api.exportChat(sid);
    const fileName = `kedai-export-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    const saved = await saveExportFile(fileName, JSON.stringify(data, null, 2));
    return saved ? fileName : null;
  }

  return {
    loadSessions,
    newSession,
    switchGreeting,
    switchSession,
    loadHistory,
    restoreAgentTrace,
    loadTokenTotals,
    updateContextTokens,
    compactCurrentChat,
    clearCurrentCompaction,
    removeMessage,
    updateMessage,
    clearCurrentChat,
    exportCurrentChat,
  };
}
