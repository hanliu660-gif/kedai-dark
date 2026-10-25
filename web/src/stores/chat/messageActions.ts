// 消息操作域动作:重发(编辑后重发)/重生成/swipe 切换。
// 三者共用「先刷新历史拿真实 id,再截断,再回滚变量树」的管线;
// 跨模块调用经 deps.actions 延迟解析(loadHistory / startStream)。
import * as api from '../../api';
import { replayMvuVariables } from '../../mvu/mvuStore';
import { broadcastCardEvent, broadcastMvuUpdate } from '../../characterScriptSandbox';
import type { ChatActions, ChatDeps } from './chatContext';

export function createMessageActions(deps: ChatDeps): Partial<ChatActions> {
  const actions = deps.actions;
  const { currentSessionId, messages, generating, mvuVariables } = deps.state;

  async function resendMessage(id: number, newText?: string): Promise<void> {
    const sid = currentSessionId.value;
    if (!sid || generating.value) return;

    // 1) 刷新历史,拿到该消息落库后的真实 id(流式临时消息 id 为负,未落库)
    await actions.loadHistory(sid);
    const msg = messages.value.find((m) => m.id === id);
    if (!msg) {
      console.warn('重发目标消息不存在(刷新历史后仍未找到),已中止');
      return;
    }
    const anchorId = msg.id;
    if (anchorId <= 0) {
      // 刷新后仍未落库(如 loadHistory 失败):拒绝操作,绝不能拿负 id 截断
      console.warn('重发目标消息尚未落库,请稍后重试');
      return;
    }

    if (newText !== undefined && newText !== null && newText.trim() !== '') {
      const updated = await api.updateMessage(sid, anchorId, newText);
      const idx = messages.value.findIndex((m) => m.id === anchorId);
      if (idx >= 0) {
        messages.value[idx].content = updated.content;
        messages.value[idx].extra = updated.extra;
        delete messages.value[idx].content_display; // 同 updateMessage:清除陈旧宏展开文本
      }
    }

    const idx = messages.value.findIndex((m) => m.id === anchorId);
    if (idx < 0) return;
    const text = messages.value[idx].content;
    if (!text.trim()) return;

    // 丢弃该消息之后的所有上下文(前端 + 后端);anchor 为落库后的真实 id,恒为正
    await api.truncateMessages(sid, anchorId);
    // 变量树回滚:取 anchor 前最近一条 assistant 消息的 extra.mvu 快照推回后端
    // 覆盖会话树,新分支基于截断点的变量状态(而非旧分支的当前值);
    // 无快照则推空树,引擎下次请求时从 [InitVar] 重新初始化
    const kept = messages.value.slice(0, idx + 1);
    try {
      let snap: api.MvuSnapshot | undefined;
      for (let i = kept.length - 1; i >= 0; i--) {
        const m = kept[i];
        if (m.role === 'assistant') {
          snap = (m.extra as { mvu?: api.MvuSnapshot } | undefined)?.mvu;
          if (snap?.stat_data) break;
        }
      }
      await api.saveAssistantVars(sid, snap?.stat_data ?? {});
      mvuVariables.value = replayMvuVariables(kept);
      broadcastMvuUpdate(mvuVariables.value);
    } catch (e) {
      console.warn('回滚变量树失败(仅影响变量状态,不影响重发)', e);
    }
    messages.value = kept;
    // 服务端验证锚点仍为当前会话最后一条 user 消息且正文一致。
    await actions.startStream(text, { resendMessageId: anchorId });
  }

  async function regenerateMessage(id: number): Promise<void> {
    const sid = currentSessionId.value;
    if (!sid || generating.value) return;

    // 先刷新历史取落库后的真实 id(与 resendMessage 同理由:流式临时消息为负 id)
    await actions.loadHistory(sid);
    const idx = messages.value.findIndex((m) => m.id === id);
    if (idx < 0) {
      console.warn('重生成目标消息不存在(刷新历史后仍未找到),已中止');
      return;
    }
    const msg = messages.value[idx];
    if (msg.role !== 'assistant' || id <= 0) {
      console.warn('重生成目标消息尚未落库或不是 assistant 消息,已中止');
      return;
    }
    // 服务端锚点要求目标为最后一条消息;其后若还有消息(异常状态)先截断
    if (idx !== messages.value.length - 1) {
      await api.truncateMessages(sid, id);
      messages.value = messages.value.slice(0, idx + 1);
    }
    // 取该消息之前最近一条 user 消息作为生成输入
    let userText = '';
    for (let i = idx - 1; i >= 0; i--) {
      const m = messages.value[i];
      if (m.role === 'user') {
        userText = m.content;
        break;
      }
    }
    if (!userText.trim()) {
      console.warn('重生成目标消息前没有可用的用户消息,已中止');
      return;
    }
    // 变量树回滚:取该消息之前最近一条 assistant 消息的 extra.mvu 快照推回后端
    // 覆盖会话树,新分支基于旧分支此点的变量状态(不含本条旧快照)
    const kept = messages.value.slice(0, idx);
    try {
      let snap: api.MvuSnapshot | undefined;
      for (let i = kept.length - 1; i >= 0; i--) {
        const m = kept[i];
        if (m.role === 'assistant') {
          snap = (m.extra as { mvu?: api.MvuSnapshot } | undefined)?.mvu;
          if (snap?.stat_data) break;
        }
      }
      await api.saveAssistantVars(sid, snap?.stat_data ?? {});
      mvuVariables.value = replayMvuVariables(kept);
      broadcastMvuUpdate(mvuVariables.value);
    } catch (e) {
      console.warn('回滚变量树失败(仅影响变量状态,不影响重生成)', e);
    }
    // 清空旧内容进入流式:保留 id/extra(extra.swipes 为旧版本数组,后端收尾会追加新版本)
    messages.value[idx] = { ...msg, content: '', streaming: true };
    await actions.startStream(userText, { regenerateAssistantId: id });
  }

  async function swipeMessage(id: number, swipeId: number): Promise<void> {
    const sid = currentSessionId.value;
    if (!sid || generating.value) return;
    try {
      const res = await api.swipeMessage(sid, id, swipeId);
      const idx = messages.value.findIndex((m) => m.id === id);
      if (idx >= 0) {
        const m = messages.value[idx];
        messages.value[idx] = { ...m, content: res.content, extra: { ...m.extra, swipe_id: res.swipe_id } };
        delete messages.value[idx].content_display;
        // 卡级脚本事件流:广播 swipe 切换,payload 为楼层序号(0-based 数组下标,
        // 对齐酒馆 MESSAGE_SWIPED 的 message_id 语义——舰娘卡「随开场白切换世界书」
        // 脚本判定 messageId===0 即第一条开场白)。切会话/历史加载后的状态漂移由
        // 脚本自带的轮询兜底,事件只保证即时性。
        broadcastCardEvent('message_swiped', idx);
      }
    } catch (e) {
      console.warn('切换 swipe 版本失败', e);
    }
  }

  return { resendMessage, regenerateMessage, swipeMessage };
}
