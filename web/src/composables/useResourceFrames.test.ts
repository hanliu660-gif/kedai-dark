// @vitest-environment jsdom
// FE-5 A+C(2026-10-06 前端修复线收口批;R1 裁决 = A+C)——资源卡加载门槛与
// TavernHelper RPC 桥的收敛/错误可见性。此前本 composable 零测试(报告 §6.2
// 「运行期子系统」清单),而它是「宿主代拉第三方页面并执行其 JS」的唯一入口。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { useResourceFrames } from './useResourceFrames';
import { buildRemoteResourceHtml, clearScriptErrorNotices, isCardOwnedByFrame } from '../render';
import { allowResourceDomain, allowedResourceDomains } from '../resourceDomains';
import { resetApiTokenForTest } from '../api/client';
import type { CharacterRecord } from '../api/types';

const URL_A = 'https://card-a.test/game/index.html';
const URL_A2 = 'https://card-a.test/other.html';

type FramesApi = ReturnType<typeof useResourceFrames>;

interface Harness {
  api: FramesApi;
  wrapper: VueWrapper;
  frames: () => HTMLIFrameElement[];
}

/** 挂一个宿主组件:composable 在 setup 内调用(mounted 钩子可用),画布内容即卡片 HTML。 */
function mountHarness(cardHtml: string, options: { onCardSend?: (text: string) => void } = {}): Harness {
  let api!: FramesApi;
  const scrollArea = ref<HTMLElement | null>(null);
  const currentCharacter = ref<CharacterRecord | null>(null);
  const currentCharacterId = ref<string | null>(null);
  const Comp = defineComponent({
    setup() {
      api = useResourceFrames({ scrollArea, currentCharacter, currentCharacterId, ...options });
      return () =>
        h('div', {
          ref: (el) => (scrollArea.value = (el as HTMLElement | null) ?? null),
          innerHTML: cardHtml,
        });
    },
  });
  const wrapper = mount(Comp, { attachTo: document.body });
  return {
    api,
    wrapper,
    frames: () => Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe[data-kd-resource-frame="1"]')),
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** 上游桩:资源代理返回作者页 HTML;generate-raw 返回文本;bootstrap 供 token 引导。 */
function installFetchMock(): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes('/bootstrap')) return jsonResponse({ token: 'test-token' });
    if (url.includes('/resource/proxy')) {
      return jsonResponse({ html: '<html><body>资源页</body></html>', base_url: 'https://card-a.test/' });
    }
    if (url.includes('/chat/generate-raw')) return jsonResponse({ ok: true, text: '生成结果', injected: [] });
    return jsonResponse({});
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

function proxyCalls(mock: ReturnType<typeof vi.fn>): unknown[][] {
  return mock.mock.calls.filter(([u]) => String(u).includes('/resource/proxy'));
}
function generateCalls(mock: ReturnType<typeof vi.fn>): unknown[][] {
  return mock.mock.calls.filter(([u]) => String(u).includes('/chat/generate-raw'));
}

/** 构造带 source 的消息事件(jsdom 下 source 可经 defineProperty 指定)。 */
function messageFrom(source: unknown, data: unknown): MessageEvent {
  const ev = new MessageEvent('message', { data });
  Object.defineProperty(ev, 'source', { value: source });
  return ev;
}

function nonceOf(): string {
  const card = document.querySelector('[data-kd-resource-url]') as HTMLElement | null;
  return card?.dataset.kdResourceNonce ?? '';
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

let harness: Harness | null = null;

beforeEach(() => {
  localStorage.clear();
  resetApiTokenForTest();
});

afterEach(() => {
  harness?.wrapper.unmount();
  harness = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('FE-5 A 域名确认门槛', () => {
  it('首次遇新域名:只出确认,不注册、不预拉取(不触碰作者服务器)', async () => {
    const fetchMock = installFetchMock();
    harness = mountHarness(buildRemoteResourceHtml(URL_A, 'seedA'));
    await harness.api.hydrate();

    expect(proxyCalls(fetchMock).length).toBe(0);
    const note = document.querySelector('.sv-resource-card-note') as HTMLElement;
    expect(note.textContent).toContain('card-a.test');
    const btn = note.querySelector('button') as HTMLButtonElement;
    expect(btn.textContent).toBe('加载此域名');

    // 幂等:重复扫描(hydrate 由渲染/滚动反复触发)不叠第二个按钮、仍不拉取
    await harness.api.hydrate();
    await harness.api.hydrate();
    expect(note.querySelectorAll('button').length).toBe(1);
    expect(proxyCalls(fetchMock).length).toBe(0);
  });

  it('确认一次后放行,并按域名记忆(同域名第二张卡不再确认)', async () => {
    const fetchMock = installFetchMock();
    harness = mountHarness(buildRemoteResourceHtml(URL_A, 'seedA'));
    await harness.api.hydrate();
    (document.querySelector('.sv-resource-card-note button') as HTMLButtonElement).click();
    await flush();

    expect(allowedResourceDomains()).toEqual(['card-a.test']);
    expect(proxyCalls(fetchMock).length).toBe(1);
    expect(document.querySelector('.sv-resource-card-note button')).toBeNull();

    // 同域名、不同 URL 的第二张卡:直接放行(域名记忆生效),无确认按钮
    harness.wrapper.unmount();
    document.body.innerHTML = '';
    harness = mountHarness(buildRemoteResourceHtml(URL_A2, 'seedA2'));
    await harness.api.hydrate();
    await flush();
    expect(document.querySelector('.sv-resource-card-note button')).toBeNull();
    expect(proxyCalls(fetchMock).length).toBe(2);
  });

  it('既有行为不回归:已确认域名 + ready(带 nonce)照常投递 boot', async () => {
    allowResourceDomain(URL_A);
    installFetchMock();
    harness = mountHarness(buildRemoteResourceHtml(URL_A, 'seedA'));
    await harness.api.hydrate();
    expect(document.querySelector('.sv-resource-card-note button')).toBeNull();

    const frame = harness.frames()[0];
    const cw = frame.contentWindow as Window;
    const spy = vi.spyOn(cw, 'postMessage');
    harness.api.handleMessage(
      messageFrom(cw, { channel: 'kedai-resource-frame-v1', nonce: nonceOf(), type: 'ready' }),
    );
    await flush();
    await flush();
    const boot = spy.mock.calls
      .map(([m]) => m as { type?: string })
      .find((m) => m.type === 'boot');
    expect(boot).toBeTruthy();
  });
});

describe('FE-5 C 生成调用节流与错误可见性', () => {
  it('窗口内第 7 次 generate 被拒(前 6 次照常,限流不回上游)', async () => {
    allowResourceDomain(URL_A);
    const fetchMock = installFetchMock();
    harness = mountHarness(buildRemoteResourceHtml(URL_A, 'seedA'));
    await harness.api.hydrate();
    const cw = harness.frames()[0].contentWindow as Window;
    const spy = vi.spyOn(cw, 'postMessage');
    const nonce = nonceOf();

    for (let i = 0; i < 7; i++) {
      harness.api.handleMessage(
        messageFrom(cw, {
          channel: 'kedai-resource-frame-v1',
          nonce,
          type: 'tavern-call',
          callId: `tc${i}`,
          method: 'generate',
          args: { user_input: `第${i}次` },
        }),
      );
    }
    await flush();
    await flush();

    const replies = spy.mock.calls
      .map(([m]) => m as { type?: string; callId?: string; ok?: boolean; error?: string })
      .filter((m) => m.type === 'tavern-result');
    expect(replies.length).toBe(7);
    const throttled = replies.filter((r) => r.ok === false);
    expect(throttled.length).toBe(1);
    expect(throttled[0].callId).toBe('tc6');
    expect(String(throttled[0].error)).toContain('限流');
    // 被拒的那次没有发起上游调用:上游 generate-raw 恰好 6 次
    expect(generateCalls(fetchMock).length).toBe(6);
  });

  it('认不出的来源:回显式 error + 诊断日志(静默挂起改 error)', async () => {
    const fetchMock = installFetchMock();
    harness = mountHarness(buildRemoteResourceHtml(URL_A, 'seedA'));
    // 不 hydrate(模拟未接线/身份不匹配:resourceFrames 里没有这个来源)
    const stranger = { postMessage: vi.fn() };
    harness.api.handleMessage(
      messageFrom(stranger, {
        channel: 'kedai-resource-frame-v1',
        type: 'tavern-call',
        callId: 'tc-x',
        method: 'generate',
        args: { user_input: 'hi' },
      }),
    );
    expect(stranger.postMessage).toHaveBeenCalledTimes(1);
    const [msg] = stranger.postMessage.mock.calls[0] as [Record<string, unknown>];
    expect(msg).toMatchObject({ type: 'tavern-result', callId: 'tc-x', ok: false });
    expect(String(msg.error)).toContain('未授权或已失效');
    expect(generateCalls(fetchMock).length).toBe(0);
    const log = JSON.parse(localStorage.getItem('kedai.tavern-call-log') ?? '[]') as Array<{
      phase?: string;
      callId?: string;
    }>;
    expect(log.some((e) => e.phase === 'unmatched' && e.callId === 'tc-x')).toBe(true);
  });

  it('非 generate 方法与空消息仍各自回错(既有分支不回归)', async () => {
    allowResourceDomain(URL_A);
    installFetchMock();
    harness = mountHarness(buildRemoteResourceHtml(URL_A, 'seedA'));
    await harness.api.hydrate();
    const cw = harness.frames()[0].contentWindow as Window;
    const spy = vi.spyOn(cw, 'postMessage');
    const nonce = nonceOf();
    harness.api.handleMessage(
      messageFrom(cw, { channel: 'kedai-resource-frame-v1', nonce, type: 'tavern-call', callId: 'n1', method: 'other' }),
    );
    harness.api.handleMessage(
      messageFrom(cw, { channel: 'kedai-resource-frame-v1', nonce, type: 'tavern-call', callId: 'n2', method: 'generate', args: {} }),
    );
    await flush();
    const byId = new Map(
      spy.mock.calls
        .map(([m]) => m as { type?: string; callId?: string; ok?: boolean; error?: string })
        .filter((m) => m.type === 'tavern-result')
        .map((m) => [m.callId, m]),
    );
    expect(byId.get('n1')?.ok).toBe(false);
    expect(String(byId.get('n1')?.error)).toContain('不支持的调用');
    expect(byId.get('n2')?.ok).toBe(false);
    expect(String(byId.get('n2')?.error)).toContain('消息列表为空');
  });
});

// B1 补丁(2026-10-29):整页前端卡的「完成确认」在酒馆里是
// `createChatMessages([{role:'user',message:'开始游戏'}]) + triggerSlash('/trigger')`,
// 这两步拆成「暂存正文」与「依宿主发送」两段 RPC。缺了它们作者页只会静默失败
// (异常在 Promise 里被吞,用户点了确认毫无反应)。
describe('整页卡的 createChatMessages / triggerSlash 两步', () => {
  it('暂存正文后 /trigger 交给宿主发送,暂存被清空', async () => {
    allowResourceDomain(URL_A);
    installFetchMock();
    const sent: string[] = [];
    harness = mountHarness(buildRemoteResourceHtml(URL_A, 'seedA'), { onCardSend: (t) => sent.push(t) });
    await harness.api.hydrate();
    const cw = harness.frames()[0].contentWindow as Window;
    const spy = vi.spyOn(cw, 'postMessage');
    const nonce = nonceOf();
    const call = (callId: string, method: string, args: unknown): void => {
      harness?.api.handleMessage(
        messageFrom(cw, { channel: 'kedai-resource-frame-v1', nonce, type: 'tavern-call', callId, method, args }),
      );
    };
    call('c1', 'createChatMessages', [{ role: 'user', message: '开始游戏' }]);
    await flush();
    // 只暂存:这时还不该开一轮生成
    expect(sent).toEqual([]);
    call('c2', 'triggerSlash', '/trigger');
    await flush();
    expect(sent).toEqual(['开始游戏']);
    // 第二次 /trigger 不重复发送(暂存已清)
    call('c3', 'triggerSlash', '/trigger');
    await flush();
    expect(sent).toEqual(['开始游戏']);
    const ok = spy.mock.calls
      .map(([m]) => m as { type?: string; callId?: string; ok?: boolean })
      .filter((m) => m.type === 'tavern-result' && m.ok === true)
      .map((m) => m.callId);
    expect(ok).toContain('c1');
    expect(ok).toContain('c2');
  });

  it('宿主没接 onCardSend 时明确回错,不假装已发出', async () => {
    allowResourceDomain(URL_A);
    installFetchMock();
    harness = mountHarness(buildRemoteResourceHtml(URL_A, 'seedA'));
    await harness.api.hydrate();
    const cw = harness.frames()[0].contentWindow as Window;
    const spy = vi.spyOn(cw, 'postMessage');
    const nonce = nonceOf();
    harness.api.handleMessage(
      messageFrom(cw, {
        channel: 'kedai-resource-frame-v1',
        nonce,
        type: 'tavern-call',
        callId: 'd1',
        method: 'triggerSlash',
        args: '/trigger',
      }),
    );
    await flush();
    const [msg] = spy.mock.calls.map(([m]) => m as { type?: string; callId?: string; error?: string }).filter((m) => m.type === 'tavern-result');
    expect(msg?.callId).toBe('d1');
    expect(String(msg?.error)).toContain('不支持');
  });

  it('未实现的 slash 指令回错(不静默成功)', async () => {
    allowResourceDomain(URL_A);
    installFetchMock();
    harness = mountHarness(buildRemoteResourceHtml(URL_A, 'seedA'), { onCardSend: () => undefined });
    await harness.api.hydrate();
    const cw = harness.frames()[0].contentWindow as Window;
    const spy = vi.spyOn(cw, 'postMessage');
    const nonce = nonceOf();
    harness.api.handleMessage(
      messageFrom(cw, {
        channel: 'kedai-resource-frame-v1',
        nonce,
        type: 'tavern-call',
        callId: 'e1',
        method: 'triggerSlash',
        args: '/hide',
      }),
    );
    await flush();
    const replies = spy.mock.calls.map(([m]) => m as { type?: string; ok?: boolean; error?: string }).filter((m) => m.type === 'tavern-result');
    expect(replies[0]?.ok).toBe(false);
    expect(String(replies[0]?.error)).toContain('未实现该指令');
  });
});

// B1 批(2026-10-29):整页脚本卡的 HTML 交给隔离文档后,沙箱「兼容执行器」那次镜像执行
// 必然失败(拿不到真实 DOM),它挂出来的「[脚本] …」红字属假故障 —— 卡在框架里其实能跑。
// 这两条是「假故障不显示 / 留下残留也清掉」的判定与清理口径。
describe('整页卡接管后的脚本失败提示口径', () => {
  function box(html: string): HTMLElement {
    const el = document.createElement('div');
    el.innerHTML = html;
    return el;
  }

  it('容器里有整页卡 iframe 时判定为已接管', () => {
    const scoped = box('<div data-kd-scope="s1"><iframe data-kd-inline-frame="1"></iframe></div>');
    expect(isCardOwnedByFrame(scoped)).toBe(true);
    const plain = box('<div data-kd-scope="s2"><p class="sv-script-error">[脚本] x</p></div>');
    expect(isCardOwnedByFrame(plain)).toBe(false);
  });

  it('清理只移除失败提示,不碰正文', () => {
    const scoped = box('<p class="sv-script-error">[脚本] a</p><p>正文</p><p class="sv-script-error">[脚本] b</p>');
    expect(clearScriptErrorNotices(scoped)).toBe(2);
    expect(scoped.querySelectorAll('.sv-script-error').length).toBe(0);
    expect(scoped.textContent).toContain('正文');
  });

  it('没有提示时清理为 0 且可重复调用', () => {
    const scoped = box('<p>正文</p>');
    expect(clearScriptErrorNotices(scoped)).toBe(0);
    expect(clearScriptErrorNotices(scoped)).toBe(0);
  });

  // 实跑补充(2026-10-29):整页卡窗口与沙箱执行容器在气泡里是**兄弟**关系——
  // 沙箱侧 `[脚本] …` 提示挂在 `.status-card` 里,而 frame 在消息的另一个分支。
  // 只查容器自身会漏判,提示照样冒出来(用户实测「可用了但红字还在」)。
  it('容器内无 iframe 但同一条消息里有整页卡窗口时,也判定为已接管', () => {
    const msg = box(
      '<div class="sv-msg assistant"><div class="min-w-0">'
        + '<div class="sv-msg-bubble sv-msg-md"><div class="status-card"><p class="sv-script-error">[脚本] x</p></div></div>'
        + '<div class="sv-resource-card"><iframe data-kd-inline-frame="1"></iframe></div>'
        + '</div></div>',
    );
    const container = msg.querySelector('.status-card') as HTMLElement;
    expect(isCardOwnedByFrame(container)).toBe(true);
    // 清理要爬到消息根:提示在容器内,frame 在兄弟层
    expect(clearScriptErrorNotices(container)).toBe(1);
    expect(msg.querySelectorAll('.sv-script-error').length).toBe(0);
  });

  it('消息里没有整页卡窗口时仍按容器自身判定(保留失败提示)', () => {
    const msg = box(
      '<div class="sv-msg assistant"><div class="status-card"><p class="sv-script-error">[脚本] x</p></div></div>',
    );
    const container = msg.querySelector('.status-card') as HTMLElement;
    expect(isCardOwnedByFrame(container)).toBe(false);
  });
});
