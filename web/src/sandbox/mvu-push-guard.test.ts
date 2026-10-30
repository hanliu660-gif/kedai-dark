// @vitest-environment node
import { describe, expect, it } from 'vitest';
// @types/node 未安装(tsconfig types 仅 vite/client),node:vm 无类型声明;
// 运行时 vitest 走 node 环境可正常解析。此处压类型错误而非装依赖 ——
// 与 characterScriptSandbox.test.ts 同一既有约定。
import vm from 'node:vm';
import { sandboxScript } from './boot-script';

/**
 * 变量写回守卫回归（2026-10-30 实机缺陷）：
 *   wrapStatTree 只遍历新树的键、不保留旧键 ⇒ 若把「整树替换后的残缺树」上送，
 *   宿主完整变量树会被整棵覆盖 ⇒ 整页卡「行为选项」全空、按钮点不动。
 * 故沙箱侧必须守卫：上送会让宿主丢根键时跳过。
 */
describe('变量写回根键守卫（回归）', () => {
  function run(userCode: string, initialStat: Record<string, unknown>) {
    const nonce = 'n-guard';
    const script = sandboxScript(userCode, nonce, { stat_data: initialStat, display_data: {} }, {});
    const messages: Array<Record<string, unknown>> = [];
    const listeners: Array<(ev: { data: unknown }) => void> = [];
    const sandboxGlobal = {
      parent: { postMessage: (m: Record<string, unknown>) => void messages.push(m) },
      addEventListener: (_t: string, fn: (ev: { data: unknown }) => void) => void listeners.push(fn),
      console,
      structuredClone: (v: unknown) => JSON.parse(JSON.stringify(v)),
      queueMicrotask,
      Promise,
      setTimeout,
      window: {},
    };
    vm.createContext(sandboxGlobal);
    new vm.Script(script).runInContext(sandboxGlobal);
    return { messages, settle: () => new Promise((r) => setTimeout(r, 40)) };
  }

  it('整树替换丢掉根键时不上送（否则会冲毁宿主变量树）', async () => {
    // 初始有「行为选项」根键;脚本调 replaceVariables({hp:5}) = 整树替换,根键消失
    const { messages, settle } = run("replaceVariables({hp:5});", { 行为选项: { 可选: ['a'] } });
    await settle();
    const replaced = messages.filter((m) => m.type === 'mvu-replace');
    expect(replaced.length).toBe(0);
  });

  it('保留根键的增量写入正常上送', async () => {
    const { messages, settle } = run("insertOrAssignVariables({hp:5});", { 行为选项: { 可选: [] } });
    await settle();
    const replaced = messages.filter((m) => m.type === 'mvu-replace');
    expect(replaced.length).toBeGreaterThanOrEqual(1);
    const payload = replaced[0].data as { stat_data: Record<string, unknown> };
    // 根键「行为选项」必须还在载荷里（证明没被冲掉）
    expect(payload.stat_data).toHaveProperty('行为选项');
  });

  it('空树上送被跳过（同样会清空宿主）', async () => {
    const { messages, settle } = run("replaceMvuData({stat_data:{}});", { 行为选项: {} });
    await settle();
    const replaced = messages.filter((m) => m.type === 'mvu-replace');
    expect(replaced.length).toBe(0);
  });
});
