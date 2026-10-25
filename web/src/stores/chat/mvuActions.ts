// mvu 变量域动作:消息完成后解析 UpdateVariable、持久化快照并广播给卡脚本沙箱。
import * as api from '../../api';
import { emitMvuEvent } from '../../mvu/host';
import { parseUpdateVariable } from '../../mvu/parser';
import { applyMvuCommands } from '../../mvu/mvuStore';
import { broadcastMvuUpdate } from '../../characterScriptSandbox';
import type { ChatActions, ChatDeps } from './chatContext';

export function createMvuActions(deps: ChatDeps): Partial<ChatActions> {
  const { currentSessionId, mvuVariables, agentMode, eventLog } = deps.state;

  /** 消息完成时更新变量树并持久化快照(assistant 消息,解析 UpdateVariable) */
  async function applyMvuUpdate(m: { id: number; content: string; extra?: Record<string, unknown> }): Promise<void> {
    const parsed = parseUpdateVariable(m.content);
    if (parsed.commands.length === 0 && !parsed.initvar) return;
    // initvar 仅在变量树为空时播种(开场初始化),随后按序应用 _.set/JSONPatch 命令
    mvuVariables.value = applyMvuCommands(mvuVariables.value, parsed.commands, parsed.initvar);
    // 兼容原版 MagVarUpdate:变量更新后触发 mag_variable_updated 事件
    emitMvuEvent('mag_variable_updated', {
      stat_data: mvuVariables.value.stat_data,
      display_data: mvuVariables.value.display_data,
    });
    // 广播给存活的角色卡脚本沙箱(wuwa 状态栏 eventOn 订阅随之重渲染)
    broadcastMvuUpdate(mvuVariables.value);
    // 持久化快照到该消息 extra.mvu
    if (currentSessionId.value && m.id > 0) {
      try {
        await api.saveMessageVariables(currentSessionId.value, m.id, {
          stat_data: mvuVariables.value.stat_data,
          display_data: mvuVariables.value.display_data,
        });
      } catch (e) {
        console.warn('保存变量快照失败', e);
      }
    }
  }

  /** 设置 Agent 模式(fast/deep/agent/custom;进请求体 agent_mode,见 sendMessage) */
  function setAgentMode(mode: api.AgentMode): void {
    agentMode.value = mode;
  }

  /** 清空事件日志(开发工具面板「清空」按钮;采集口 onSseEvent 见下)。 */
  function clearEventLog(): void {
    eventLog.value = [];
  }

  return { applyMvuUpdate, setAgentMode, clearEventLog };
}
