// 类型域拆分后的结构护栏（2026-11-07，本机按上游目录形状拆 api/types.ts）。
//
// 目的有三：
// 1) 每个域文件都被测试直接 import——零测试 ratchet 要求新源码文件有直接引用；
// 2) 断言 `api/types.ts`（旧路径）与 `api/types/index.ts`（新 barrel）都保持
//    **零运行期导出**：类型域拆分只搬声明，不得顺手带进常量/函数（否则 barrel
//    会从「纯类型门面」变成运行期模块，影响 tree-shaking 与首屏体积）；
// 3) 每个域的代表类型仍可解析——纯 type import 在 vue-tsc 阶段兜住拼写/路径错误。
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { CharacterRecord, ChatMessage, RegexScript, ScriptTreeNode } from './character';
import type { SseEvent, TokenUsage } from './chat';
import type { ToolPermission, ToolRisk } from './tools';
import type { TaskDetail, TaskEvent, TaskRecord, TaskStep } from './task';
import type { AgentFlowConfig, AgentFlowStep } from './agentFlow';
import type { ConnectionProfile, RuntimeSettings, RuntimeSettingsPatch } from './settings';
import type { WorldBookEntry, WorldBookRecord } from './worldbook';
import type { AudioChannelState, AudioTrack } from './audio';
import type { WorkspaceProfile } from './workspace';
import type { KedaiImportBundle, MacroExpandCtx } from './misc';

describe('api/types 域拆分', () => {
  it('各域代表类型仍可解析', () => {
    expectTypeOf<CharacterRecord>().toMatchTypeOf<{ id: string }>();
    expectTypeOf<ChatMessage>().toMatchTypeOf<object>();
    expectTypeOf<RegexScript>().toMatchTypeOf<object>();
    expectTypeOf<ScriptTreeNode>().toMatchTypeOf<object>();
    expectTypeOf<TokenUsage>().toMatchTypeOf<object>();
    expectTypeOf<SseEvent>().toMatchTypeOf<object>();
    expectTypeOf<ToolRisk>().toEqualTypeOf<'safe' | 'sensitive' | 'dangerous'>();
    expectTypeOf<ToolPermission>().toMatchTypeOf<object>();
    expectTypeOf<TaskRecord>().toMatchTypeOf<object>();
    expectTypeOf<TaskStep>().toMatchTypeOf<object>();
    expectTypeOf<TaskEvent>().toMatchTypeOf<object>();
    expectTypeOf<TaskDetail>().toMatchTypeOf<object>();
    expectTypeOf<AgentFlowStep>().toMatchTypeOf<object>();
    expectTypeOf<AgentFlowConfig>().toMatchTypeOf<object>();
    expectTypeOf<ConnectionProfile>().toMatchTypeOf<{ base_url: string }>();
    expectTypeOf<RuntimeSettings>().toMatchTypeOf<object>();
    expectTypeOf<RuntimeSettingsPatch>().toMatchTypeOf<object>();
    expectTypeOf<WorldBookRecord>().toMatchTypeOf<object>();
    expectTypeOf<WorldBookEntry>().toMatchTypeOf<object>();
    expectTypeOf<AudioTrack>().toMatchTypeOf<object>();
    expectTypeOf<AudioChannelState>().toMatchTypeOf<object>();
    expectTypeOf<WorkspaceProfile>().toMatchTypeOf<object>();
    expectTypeOf<MacroExpandCtx>().toMatchTypeOf<object>();
    expectTypeOf<KedaiImportBundle>().toMatchTypeOf<object>();
  });

  it('新 barrel 与旧路径都没有运行期导出（纯类型模块）', async () => {
    const viaIndex = await import('./index');
    const viaLegacy = await import('../types');
    expect(Object.keys(viaIndex)).toEqual([]);
    expect(Object.keys(viaLegacy)).toEqual([]);
  });
});
