// 聊天 store 的共享上下文类型:状态 ref + 动作注册表(动作间跨模块调用走 actions,
// 避免模块之间形成静态依赖环)。
import type { Ref } from 'vue';
import type * as api from '../../api';
import type { AgentActivity, UiMessage } from '../../sseReducer';
import type { MvuVars } from '../../mvu/mvuStore';
import type { ApiEventLogEntry } from '../../devTools';

/** 状态(全部为 ref,由 state.ts 创建,store 原样返回给组件) */
export interface ChatState {
  currentSessionId: Ref<string | null>;
  sessions: Ref<api.SessionInfo[]>;
  messages: Ref<UiMessage[]>;
  generating: Ref<boolean>;
  agent: Ref<AgentActivity>;
  lastUsage: Ref<api.TokenUsage | null>;
  contextTokens: Ref<number>;
  agentMode: Ref<api.AgentMode>;
  cacheZeroStreak: Ref<number>;
  sessionTotalTokens: Ref<number>;
  globalTotalTokens: Ref<number>;
  mvuVariables: Ref<MvuVars>;
  initVarEntries: Ref<Record<string, string>>;
  eventLog: Ref<ApiEventLogEntry[]>;
}

/** 全部动作(store 对外暴露的方法面) */
export interface ChatActions {
  loadSessions(characterId: string): Promise<void>;
  newSession(greetingIndex?: number): Promise<void>;
  switchGreeting(greetingIndex: number): Promise<void>;
  switchSession(id: string): Promise<void>;
  loadHistory(sessionId: string): Promise<void>;
  restoreAgentTrace(sessionId: string): Promise<void>;
  loadTokenTotals(sessionId?: string): Promise<void>;
  updateContextTokens(msgs: Array<{ role: string; content: string }>): Promise<void>;
  removeMessage(id: number): Promise<void>;
  updateMessage(id: number, content: string): Promise<void>;
  clearCurrentChat(): Promise<void>;
  compactCurrentChat(): Promise<{ compacted: boolean }>;
  clearCurrentCompaction(): Promise<{ cleared: boolean }>;
  exportCurrentChat(): Promise<string | null>;
  applyMvuUpdate(m: { id: number; content: string; extra?: Record<string, unknown> }): Promise<void>;
  setAgentMode(mode: api.AgentMode): void;
  clearEventLog(): void;
  sendMessage(text: string): Promise<void>;
  startStream(
    text: string,
    opts?: { resendMessageId?: number; regenerateAssistantId?: number },
  ): Promise<void>;
  resendMessage(id: number, newText?: string): Promise<void>;
  regenerateMessage(id: number): Promise<void>;
  swipeMessage(id: number, swipeId: number): Promise<void>;
  onSseEvent(event: api.SseEvent): void;
  stop(): void;
}

/** 模块工厂收到的参数:state 直取,跨模块调用走 actions(创建期后回填) */
export interface ChatDeps {
  state: ChatState;
  actions: ChatActions;
}
