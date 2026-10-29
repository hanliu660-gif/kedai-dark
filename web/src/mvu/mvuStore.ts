// mvu 状态纯函数:消息级快照回放、深度合并与 UpdateVariable 命令应用(store 层调用)
import { applyCommands } from './variables';
import { emptyVariables } from './variables';
import type { MvuVariables } from './variables';
import { parseUpdateVariable } from './parser';
import type { UpdateCommand } from './parser';
import { applyInitVarContent, collectInitVars } from './initvar';
import type { MvuSnapshot } from '../api';

export type { MvuVariables };
export type MvuVars = MvuVariables;

/** 深度合并(对象递归,数组/标量覆盖) */
export function deepMergeVars(target: Record<string, unknown>, patch: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(patch)) {
    const tv = target[k];
    if (
      typeof v === 'object' &&
      v !== null &&
      !Array.isArray(v) &&
      typeof tv === 'object' &&
      tv !== null &&
      !Array.isArray(tv)
    ) {
      deepMergeVars(tv as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      target[k] = v;
    }
  }
}

/** 按消息顺序回放 mvu 变量快照(extra.mvu),得到当前会话变量状态 */
export function replayMvuVariables(
  msgs: Array<{ role: string; content?: string; extra?: Record<string, unknown> }>,
): MvuVariables {
  const vars = emptyVariables();
  let snapshotSeen = false;
  for (const m of msgs) {
    if (m.role !== 'assistant') continue;
    const snap = (m.extra as { mvu?: MvuSnapshot } | undefined)?.mvu;
    if (!snap?.stat_data) {
      // 无快照的 assistant 消息(开场白):携带 <initvar> 且尚未见任何快照时,
      // 作为初始变量播种(开场白是种子消息,不经 applyMvuUpdate,快照里不会有它)。
      // 一旦快照开始出现则以快照为准(快照生成时已含播种结果),避免复活已删除的键。
      if (!snapshotSeen && Object.keys(vars.stat_data).length === 0 && m.content?.includes('<initvar>')) {
        const parsed = parseUpdateVariable(m.content);
        if (parsed.initvar) applyInitVarContent(vars, parsed.initvar);
      }
      continue;
    }
    snapshotSeen = true;
    // 深度合并(对象递归;叶子覆盖),变量树按消息推进;
    // display_data 缺失时用 stat_data 镜像(后端快照只含 stat_data)
    deepMergeVars(vars.stat_data, snap.stat_data);
    deepMergeVars(vars.display_data, snap.display_data ?? snap.stat_data);
  }
  return vars;
}

/**
 * 世界书 [InitVar] 播种:把角色可用 [InitVar] 条目(可禁用)作为变量树的**地板**。
 *
 * 为什么单开一个入口:此前 [InitVar] 只喂「角色卡脚本沙箱」(scriptRunner 的
 * `collectInitVars`),不喂 `mvuVariables`——而整页前端卡(露出日记-0615 等)读的正是
 * `mvuVariables`。这类卡的开场白没有 `<initvar>`,初始变量只存在世界书条目里 ⇒
 * 整页卡 boot 拿到的 stat_data 恒空,「着装」展开后一条都显示不出来(实测 8 类全 0 项)。
 *
 * 语义:**补齐缺失,不覆盖已有**。
 * - 变量树为空 → 整棵用播种结果;
 * - 已有变量(消息快照/命令写过的进度)→ 快照优先,只有快照里**缺的路径**才用
 *   [InitVar] 补上(引入本修复前落库的旧快照普遍只有 `主角.名字/外观数据/身体色情记录`,
 *   缺整棵 `衣柜`;若只在「空树」播种,老会话永远修不好,用户必须重新开卡)。
 * 播种结果仍是 [值, 原因] 成对存储(原因记「初始」)。
 */
export function withInitVarSeed(vars: MvuVariables, entries: Record<string, string>): MvuVariables {
  const list = Object.entries(entries ?? {});
  if (list.length === 0) return vars;
  const seeded = collectInitVars(list.map(([comment, content]) => ({ comment, content })));
  if (Object.keys(seeded.stat_data).length === 0) return vars;
  if (Object.keys(vars.stat_data).length === 0) {
    return { stat_data: seeded.stat_data, display_data: seeded.display_data };
  }
  const stat = fillMissing(vars.stat_data, seeded.stat_data);
  if (stat === vars.stat_data) return vars;
  const disp = fillMissing(vars.display_data, seeded.display_data);
  return { stat_data: stat, display_data: disp };
}

/** 返回 base 优先、seed 只补缺失路径的新对象;无缺失时返回 base 本体(调用方据此判同一引用) */
function fillMissing(base: Record<string, unknown>, seed: Record<string, unknown>): Record<string, unknown> {
  let out: Record<string, unknown> | null = null;
  for (const key of Object.keys(seed)) {
    const sv = seed[key];
    if (!(key in base)) {
      out = out ?? { ...base };
      out[key] = sv;
      continue;
    }
    const bv = base[key];
    // 双方都是对象时才下钻;叶子对([值, 原因])或标量一律以 base 为准
    if (isPlainObject(bv) && isPlainObject(sv)) {
      const merged = fillMissing(bv, sv);
      if (merged !== bv) {
        out = out ?? { ...base };
        out[key] = merged;
      }
    }
  }
  return out ?? base;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * 深拷贝并应用 UpdateVariable 命令,返回新变量树。
 * 深拷贝:pathSet 会修改嵌套子树,浅拷贝会直接污染 reactive 原树节点,
 * 且快照与显示树会共享嵌套引用(后续命令异常时原树已被改坏)。
 * initvarRaw:消息携带的 <initvar> 段,仅在变量树为空时先播种再应用命令
 * (开场初始化语义;已有变量时不覆盖进行中的进度)。
 */
export function applyMvuCommands(
  current: MvuVariables,
  commands: UpdateCommand[],
  initvarRaw?: string,
): MvuVariables {
  const vars: MvuVariables = {
    stat_data: JSON.parse(JSON.stringify(current.stat_data)) as Record<string, unknown>,
    display_data: JSON.parse(JSON.stringify(current.display_data)) as Record<string, unknown>,
  };
  if (initvarRaw && Object.keys(vars.stat_data).length === 0) {
    applyInitVarContent(vars, initvarRaw);
  }
  applyCommands(vars, commands);
  return vars;
}
