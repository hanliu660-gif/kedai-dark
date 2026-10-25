// 聊天 store 的状态定义(纯 ref 集合,不含行为)。
import { ref } from 'vue';
import type * as api from '../../api';
import { idleAgent } from '../../sseReducer';
import type { AgentActivity, UiMessage } from '../../sseReducer';
import type { MvuVars } from '../../mvu/mvuStore';
import type { ApiEventLogEntry } from '../../devTools';
import type { ChatState } from './chatContext';

export function createChatState(): ChatState {
  const currentSessionId = ref<string | null>(null);
  const sessions = ref<api.SessionInfo[]>([]);
  const messages = ref<UiMessage[]>([]);
  const generating = ref(false);
  const agent = ref<AgentActivity>(idleAgent());
  const lastUsage = ref<api.TokenUsage | null>(null);
  const contextTokens = ref(0);
  const agentMode = ref<api.AgentMode>('fast');
  /** 缓存命中率连续为 0 的次数(连续两次为 0 则隐藏命中率显示) */
  const cacheZeroStreak = ref(0);
  /** 当前会话累计 token(后端接口返回) */
  const sessionTotalTokens = ref(0);
  /** 全局累计 token(后端接口返回) */
  const globalTotalTokens = ref(0);
  /** mvu 变量树(stat_data/display_data),随历史回放与消息更新 */
  const mvuVariables = ref<MvuVars>({
    stat_data: {},
    display_data: {},
  });
  /** 当前角色 [InitVar] 初始变量(按条目 comment 保存原文,由 mvu 模块收集) */
  const initVarEntries = ref<Record<string, string>>({});
  /** SSE 事件日志(前端采集,cap 500 丢最旧;事件监控面板数据源) */
  const eventLog = ref<ApiEventLogEntry[]>([]);

  return {
    currentSessionId,
    sessions,
    messages,
    generating,
    agent,
    lastUsage,
    contextTokens,
    agentMode,
    cacheZeroStreak,
    sessionTotalTokens,
    globalTotalTokens,
    mvuVariables,
    initVarEntries,
    eventLog,
  };
}
