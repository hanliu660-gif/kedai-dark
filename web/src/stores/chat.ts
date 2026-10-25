// 聊天 store:会话/消息/流式生成(SSE)/swipe/重发/重生成、Token 统计、mvu 变量树、
// SSE 事件日志采集、会话压缩与聊天导入导出。
// 从 store.ts 按领域拆分;行为再按领域拆到 ./chat/*Actions.ts(会话 / mvu / 流式 / 消息操作),
// 本文件只负责组装:状态 → 动作注册表 → 对外暴露。跨动作模块调用经 actions 注册表,
// 不产生模块间静态依赖(与 storeBridge 的 M5 断环同一思路)。
// 跨 store 引用(currentCharacterId / 生成参数 / agentPanelOpen)均在动作运行时解析,
// setup 阶段不实例化其他 store。
import { defineStore } from 'pinia';
import { registerChatEventSink } from './storeBridge';
import { createChatState } from './chat/state';
import { createSessionActions } from './chat/sessionActions';
import { createMvuActions } from './chat/mvuActions';
import { createStreamActions } from './chat/streamActions';
import { createMessageActions } from './chat/messageActions';
import type { ChatActions, ChatDeps } from './chat/chatContext';

export const useChatStore = defineStore('app.chat', () => {
  const state = createChatState();
  // 动作注册表在创建期后回填:模块之间的调用只写 actions.xxx,不静态 import 彼此
  const actions = {} as ChatActions;
  const deps: ChatDeps = { state, actions };
  Object.assign(actions, createSessionActions(deps));
  Object.assign(actions, createMvuActions(deps));
  Object.assign(actions, createStreamActions(deps));
  Object.assign(actions, createMessageActions(deps));

  // 注册给回调桥(M5 断环):task store 的合成事件经此进事件日志与语义处理,
  // 免去 task → chat 的顶层 import。行为与直接调用 onSseEvent 完全一致。
  registerChatEventSink(actions.onSseEvent);

  // 对外暴露面显式列举(不用 ...actions 展开):restoreAgentTrace / updateContextTokens 之外的
  // 内部动作不能因为「注册表里有」就漏到门面上 —— storeFacade 的完整性测试会守住这条。
  return {
    ...state,
    clearEventLog: actions.clearEventLog,
    setAgentMode: actions.setAgentMode,
    loadSessions: actions.loadSessions,
    newSession: actions.newSession,
    switchGreeting: actions.switchGreeting,
    switchSession: actions.switchSession,
    loadHistory: actions.loadHistory,
    loadTokenTotals: actions.loadTokenTotals,
    updateContextTokens: actions.updateContextTokens,
    sendMessage: actions.sendMessage,
    startStream: actions.startStream,
    resendMessage: actions.resendMessage,
    regenerateMessage: actions.regenerateMessage,
    swipeMessage: actions.swipeMessage,
    onSseEvent: actions.onSseEvent,
    stop: actions.stop,
    compactCurrentChat: actions.compactCurrentChat,
    clearCurrentCompaction: actions.clearCurrentCompaction,
    removeMessage: actions.removeMessage,
    updateMessage: actions.updateMessage,
    clearCurrentChat: actions.clearCurrentChat,
    exportCurrentChat: actions.exportCurrentChat,
  };
});
