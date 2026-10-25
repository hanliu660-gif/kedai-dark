// 流式生成域动作:发送、发起生成、SSE 事件归并、停止。
// 跨模块调用经 deps.actions 延迟解析(newSession / loadHistory / applyMvuUpdate),
// 因为动作注册表在本模块构造完成后才回填。
import * as api from '../../api';
import { idleAgent, reduceSseEvent } from '../../sseReducer';
import { useGenSettingsStore } from '../genSettings';
import { useUiPrefsStore } from '../uiPrefs';
import { currentCharacterIdValue } from '../storeBridge';
import { chatStream } from './streamService';
import type { ChatActions, ChatDeps } from './chatContext';

export function createStreamActions(deps: ChatDeps): Partial<ChatActions> {
  const actions = deps.actions;
  const {
    currentSessionId,
    messages,
    generating,
    agent,
    lastUsage,
    contextTokens,
    agentMode,
    cacheZeroStreak,
    mvuVariables,
    eventLog,
  } = deps.state;

  // ===== 发送与流式生成 =====
  async function sendMessage(text: string): Promise<void> {
    const cid = currentCharacterIdValue();
    if (!cid || generating.value) return;

    // 无会话时先新建(后端注入开场白,保证角色上下文完整)
    if (!currentSessionId.value) await actions.newSession();

    messages.value.push({ id: -Date.now(), role: 'user', content: text, extra: {}, streaming: false });
    await startStream(text);
  }

  /** 发起流式生成(用户消息已就位时不重复 push,供「编辑后重发」复用) */
  async function startStream(
    text: string,
    opts: { resendMessageId?: number; regenerateAssistantId?: number } = {},
  ): Promise<void> {
    const cid = currentCharacterIdValue();
    if (!cid || generating.value) return;
    if (!currentSessionId.value) await actions.newSession();

    generating.value = true;
    agent.value = { ...idleAgent(), phase: 'planning', stepText: '计划中…' };
    // 生成开始时自动展开右侧 Agent 面板(仅 Deep/Agent/Custom 模式,且用户本轮未主动收起过)。
    // 只在这一次置位;生成期间的 SSE 事件不再干预面板开合(详见 AgentPanel.showPanel)。
    if (['deep', 'agent', 'custom'].includes(agentMode.value)) {
      useUiPrefsStore().autoOpenAgentPanel();
    }

    const genSettings = useGenSettingsStore();
    chatStream.start(
      {
        session_id: currentSessionId.value ?? undefined,
        character_id: cid,
        message: text,
        agent_mode: agentMode.value,
        temperature: genSettings.temperature,
        top_p: genSettings.topP,
        max_tokens: genSettings.maxTokens,
        resend_message_id: opts.resendMessageId,
        regenerate_assistant_id: opts.regenerateAssistantId,
      },
      actions.onSseEvent,
    );
  }

  function onSseEvent(event: api.SseEvent): void {
    // 事件日志采集(阶段六 6c):全部 SSE 事件(含本地合成事件,如 stop/interrupted)
    // 流经本入口,在此一次性采集;cap 500 丢最旧,带当前会话上下文便于面板过滤。
    eventLog.value.push({
      ts: Date.now(),
      // 任务模式合成事件不隶属聊天会话:空 session_id(面板会话过滤对 task 类型始终放行)
      session_id: event.type === 'task' ? '' : (currentSessionId.value ?? ''),
      event,
    });
    if (eventLog.value.length > 500) eventLog.value.splice(0, eventLog.value.length - 500);    // 事件语义处理在 sseReducer.ts(reduceSseEvent 纯函数);此处仅应用变更到响应式状态
    const changes = reduceSseEvent(
      {
        agent: agent.value,
        messages: messages.value,
        generating: generating.value,
        lastUsage: lastUsage.value,
        contextTokens: contextTokens.value,
        mvuVariables: mvuVariables.value,
      },
      event,
    );
    if (changes.generating !== undefined) generating.value = changes.generating;
    if (changes.lastUsage !== undefined) {
      lastUsage.value = changes.lastUsage;
      // 缓存命中率跟踪:连续两次为 0 则隐藏显示
      const u = changes.lastUsage;
      if (u && u.prompt_tokens > 0) {
        const hit = u.prompt_cache_hit_tokens ?? 0;
        if (hit === 0) {
          cacheZeroStreak.value += 1;
        } else {
          cacheZeroStreak.value = 0;
        }
      }
    }
    if (changes.contextTokens !== undefined) contextTokens.value = changes.contextTokens;
    if (changes.mvuVariables) mvuVariables.value = changes.mvuVariables;
    if (changes.applyMvuOn) void actions.applyMvuUpdate(changes.applyMvuOn);
    if (changes.reloadHistory && currentSessionId.value) void actions.loadHistory(currentSessionId.value);
  }

  function stop(): void {
    void chatStream.stop(currentSessionId.value)
      .catch((e) => console.warn('通知后端停止生成失败', e));
    onSseEvent({ type: 'interrupted' });
  }

  return { sendMessage, startStream, onSseEvent, stop };
}
