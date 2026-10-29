// wuwa-sim.test.ts — WuWa 悬浮窗脚本形态端到端回归(沙箱 jq 子集 → RPC 序列)。
// 复刻三个悬浮窗脚本的关键调用序列,锁定「不再 TypeError、RPC 序列完整」:
//   th-5 created 悬浮球(attr id + css 对象 + html + draggable)、
//   th-3/th-4 html 字符串 append + 按 id draggable + $(window).on(unload)、
//   css 对象形式/字符串 getter/is(':hidden')/toggle/animate 并存。
// 真实浏览器布局与拖拽手感仍需实卡复验,此处只保证脚本调用链不中断、参数不丢。
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- node:vm 缺少类型声明
import vm from 'node:vm';
import { sandboxScript } from '../characterScriptSandbox';

interface Harness {
  messages: Array<Record<string, unknown>>;
  run: (code: string) => Promise<Array<{ method?: string; ref?: { kind?: string; value?: string }; args?: unknown[] }>>;
  /** 把一条宿主→沙箱消息喂进 boot 脚本监听的 message 回调(jq-event / mvu-event 等) */
  dispatch: (data: Record<string, unknown>) => void;
}

function makeHarness(nonce: string): Harness {
  const messages: Array<Record<string, unknown>> = [];
  const listeners: Array<(ev: { data: unknown }) => void> = [];
  const sandboxWindow: Record<string, unknown> = {
    // 真实窗口有事件 API:沙箱 boot 会包一层把窗口级监听转成宿主 window 绑定,
    // 替身缺了会走「门面安装失败」分支并丢掉这条链路。
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
  };
  const sandboxGlobal = {
    parent: { postMessage: (m: Record<string, unknown>) => void messages.push(m) },
    addEventListener: (_t: string, fn: (ev: { data: unknown }) => void) => void listeners.push(fn),
    console,
    structuredClone: (v: unknown) => JSON.parse(JSON.stringify(v)),
    queueMicrotask,
    Promise,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    window: sandboxWindow,
    document: {
      head: { appendChild: () => {} },
      // 真实浏览器有 createElement:沙箱 boot 会覆写它登记钩子(原生建节点也能进容器),
      // 这里给最小可用的替身,避免覆写逻辑在 harness 下走「安装失败」分支。
      createElement: () => ({
        style: {},
        outerHTML: '<div></div>',
        className: '',
        setAttribute: () => {},
        getAttribute: () => null,
        hasAttribute: () => false,
        appendChild: () => {},
        addEventListener: () => {},
      }),
    },
  };
  vm.createContext(sandboxGlobal);
  const run = async (
    code: string,
  ): Promise<Array<{ method?: string; ref?: { kind?: string; value?: string }; args?: unknown[] }>> => {
    const script = sandboxScript(code, nonce, { stat_data: {}, display_data: {} });
    new vm.Script(script).runInContext(sandboxGlobal);
    await new Promise((r) => setTimeout(r, 15));
    // 宿主 ack 每个 batch(镜像为空即可,本例只验证 op 序列)
    for (const m of messages.filter((x) => x.type === 'batch')) {
      for (const fn of listeners) {
        fn({
          data: { channel: 'kedai-character-script-v1', nonce, type: 'rpc-result', id: m.id, ok: true, value: true },
        });
      }
    }
    await new Promise((r) => setTimeout(r, 15));
    return messages
      .filter((m) => m.type === 'batch')
      .flatMap((m) => (m.ops ?? []) as Array<{ method?: string; ref?: { kind?: string; value?: string }; args?: unknown[] }>);
  };
  const dispatch = (data: Record<string, unknown>): void => {
    for (const fn of listeners) fn({ data });
  };
  return { messages, run, dispatch };
}

describe('WuWa 悬浮窗脚本形态端到端模拟', () => {
  it('th-5 形态:created 悬浮球(attr id + css 对象 + html + draggable)全程无异常且 op 完整', async () => {
    const h = makeHarness('sim-th5');
    const code = [
      "const $ball = $('<div>').attr('id','fx-floating-ball').html('<i class=\"x\"></i>').css({position:'fixed',zIndex:9999,width:'52px',height:'52px'});",
      "$ball.draggable({ cursor:'move', distance:3, start:function(e,ui){}, drag:function(e,ui){}, stop:function(e,ui){} });",
      "$('body').append($ball);",
      "$('head').append('<style id=\"fx-style\">#fx-floating-ball{position:fixed}</style>');",
    ].join('\n');
    const ops = await h.run(code);
    // 不应出现 error 上送
    expect(h.messages.filter((m) => m.type === 'error')).toHaveLength(0);
    // created 落 DOM:appendCreated 带 spec(含 attrs.id / css / draggable)
    const appendCreated = ops.find((o) => o.method === 'appendCreated');
    expect(appendCreated).toBeTruthy();
    const spec = appendCreated?.args?.[0] as {
      attrs?: Record<string, string>;
      css?: Record<string, string>;
      draggable?: { cursor?: string; distance?: number };
    };
    expect(spec.attrs?.id).toBe('fx-floating-ball');
    expect(spec.css?.position).toBe('fixed');
    expect(spec.css?.zIndex).toBe('9999');
    expect(spec.draggable?.cursor).toBe('move');
    expect(spec.draggable?.distance).toBe(3);
    // $('head') 样式注入:append op 的 ref 值必须是 head(此前 0 匹配静默丢失)
    const headAppend = ops.find(
      (o) => o.method === 'append' && o.ref?.kind === 'selector' && o.ref?.value === 'head',
    );
    expect(headAppend).toBeTruthy();
    expect(String(headAppend?.args?.[0] ?? '')).toContain('fx-floating-ball');
  });

  it('th-3/th-4 形态:html 字符串 append 后按 id 选择器 draggable + $(window).on(unload)', async () => {
    const h = makeHarness('sim-th3');
    const code = [
      "$('body').append('<div id=\"wuwa-story-ui\" style=\"position:fixed\">x</div>');",
      "$('#wuwa-story-ui').draggable({ handle:'.head', containment:'window', start:function(e,ui){}, stop:function(e,ui){} });",
      "$(window).on('unload', function(){});",
      "$(window).on('pagehide', function(){});",
    ].join('\n');
    const ops = await h.run(code);
    expect(h.messages.filter((m) => m.type === 'error')).toHaveLength(0);
    const drag = ops.find((o) => o.method === 'draggable' && o.ref?.value === '#wuwa-story-ui');
    expect(drag).toBeTruthy();
    expect((drag?.args?.[0] as { containment?: string })?.containment).toBe('window');
    // $(window) 事件:ref.kind 为 window(此前 ref=null 静默失效)
    const winOn = ops.filter((o) => o.method === 'on' && o.ref?.kind === 'window');
    expect(winOn.length).toBe(2);
  });

  // 回归:jQuery 动画方法的回调必须执行。卡里的「关闭」是
  //   s.stop(true,true).fadeOut(120, function(){ 把球重新显示出来 })
  // 垫片早期把回调整个丢掉 => 点关闭后球永久消失、只能刷新(2026-10-29 实跑复现)。
  it('fadeOut/fadeIn/hide/show/slideUp 的效果回调都会执行(关面板后球要能回来)', async () => {
    const h = makeHarness('sim-anim-cb');
    const code = [
      "$('<div>').appendTo('body').stop(true, true).fadeOut(10, function(){ warn('cb-fadeOut'); });",
      "$('<div>').appendTo('body').fadeIn(10, function(){ warn('cb-fadeIn'); });",
      "$('<div>').appendTo('body').hide(10, function(){ warn('cb-hide'); });",
      "$('<div>').appendTo('body').show(10, function(){ warn('cb-show'); });",
      "$('<div>').appendTo('body').slideUp(function(){ warn('cb-slideUp'); });",
    ].join('\n');
    await h.run(code);
    await new Promise((r) => setTimeout(r, 60));
    const cbs = h.messages
      .filter((m) => m.type === 'warn')
      .map((m) => String(m.message))
      .filter((w) => w.startsWith('cb-'));
    expect(cbs.sort()).toEqual(['cb-fadeIn', 'cb-fadeOut', 'cb-hide', 'cb-show', 'cb-slideUp']);
  });

  it('css 对象形式与字符串 getter 并存,is(:hidden)/toggle 不抛错', async () => {
    const h = makeHarness('sim-css');
    const code = [
      "$('#p').css({display:'none',position:'fixed'});",
      "const d = $('#p').css('display');",
      "$('#p').toggle();",
      "if($('#p').is(':hidden')){}",
      "$('#p').animate({scrollTop:100},200);",
    ].join('\n');
    await h.run(code);
    expect(h.messages.filter((m) => m.type === 'error')).toHaveLength(0);
    const cssOps = h.messages
      .filter((m) => m.type === 'batch')
      .flatMap((m) => (m.ops ?? []) as Array<{ method?: string; args?: unknown[] }>)
      .filter((o) => o.method === 'css');
    // 对象形式逐键入队:display 与 position 各一条
    expect(cssOps.some((o) => o.args?.[0] === 'display')).toBe(true);
    expect(cssOps.some((o) => o.args?.[0] === 'position')).toBe(true);
  });
});

// B1 批补丁(2026-10-29):整页脚本卡在**兼容执行器**里跑时,`.filter(sel)` 等集合方法缺失
// 会让整段装配脚本中断(实跑:露出日记-0615 报 `$(...).filter is not a function`),
// 进而把假故障红字挂到已能正常显示的气泡上。这里锁定「链式不抛错、状态操作仍发出」。
describe('jq 子集集合方法兼容(B1 实测缺口)', () => {
  it('filter/not/eq/first/last/is/closest 链式调用不抛错且保留后续操作', async () => {
    const h = makeHarness('sim-filter');
    const code = [
      "$('.piece').filter('.pick').addClass('on');",
      "$('.piece').not('.pick').removeClass('on');",
      "$('.piece').eq(0).attr('data-first','1');",
      "$('.piece').first().css('color','#fff');",
      "$('.piece').last().val('x');",
      "$('.piece').is('.pick');",
      "$('.piece').closest('.wrap').find('.inner').addClass('deep');",
      "$('.piece').parent().children().siblings().toArray();",
      "$('.piece').map(function(i, el){ return el; });",
    ].join('\n');
    const ops = await h.run(code);
    expect(h.messages.filter((m) => m.type === 'error')).toHaveLength(0);
    // 链式之后的写操作必须真的发出去(返回自身而不是 undefined)
    expect(ops.some((o) => o.method === 'addClass' && o.ref?.value === '.piece')).toBe(true);
    expect(ops.some((o) => o.method === 'attr' && String(o.args?.[0]) === 'data-first')).toBe(true);
    expect(ops.some((o) => o.method === 'css' && String(o.args?.[0]) === 'color')).toBe(true);
  });
});

// 悬浮球-0613(露出日记-0615 卡内脚本)实测缺口:作者用 `$('<div>').appendTo('body')` 建节点,
// 之后所有操作都作用在那批**游离元素**上。此前 jqCreated 没有 appendTo、句柄也会在挂载后丢失,
// 于是第一条 appendTo 就 TypeError,界面上连球都不出现。这里锁定两条:RPC 序列完整、挂载后操作带句柄。
describe('游离元素 appendTo 挂载(悬浮球形态)', () => {
  it("$('<div>').appendTo('body') 落 DOM,子面板挂到父句柄,隐藏/淡入带 kdel 句柄发出", async () => {
    const h = makeHarness('sim-momo');
    const code = [
      "const r=$('<div>').attr('data-momo-floating-root','1').css({position:'fixed',right:'12px',bottom:'90px'}).appendTo('body');",
      "const s=$('<div></div>').css({width:'360px',height:'520px'}).appendTo(r).hide();",
      "s.stop(true,true).fadeIn(120);",
      "s.hide();",
    ].join('\n');
    const ops = await h.run(code);
    expect(h.messages.filter((m) => m.type === 'error')).toHaveLength(0);
    // 根节点挂 body:宿主把 body 映射到覆层根
    const root = ops.find((o) => o.method === 'appendCreated' && o.ref?.kind === 'selector');
    expect(root?.ref).toMatchObject({ kind: 'selector', value: 'body' });
    // 面板挂到根节点的已落 DOM 句柄(kdel),不是再挂一次 body
    expect(ops.some((o) => o.method === 'appendCreated' && o.ref?.kind === 'kdel')).toBe(true);
    // 挂载后的 hide/fadeIn 必须带句柄:多数 op 是 kdel ref
    const cssOps = ops.filter((o) => o.method === 'css');
    expect(cssOps.length).toBeGreaterThanOrEqual(3);
  });

  it('原生 createElement 造的元素 appendChild 进 jq 元素时随 spec 一起落 DOM', async () => {
    const h = makeHarness('sim-momo-native');
    const code = [
      "const r=$('<div>').appendTo('body');",
      "const a=document.createElement('button'); a.textContent='墨';",
      "a.style.display='block';",
      "r[0].appendChild(a);",
    ].join('\n');
    const ops = await h.run(code);
    expect(h.messages.filter((m) => m.type === 'error')).toHaveLength(0);
    const created = ops.filter((o) => o.method === 'appendCreated');
    // 至少两次:根节点 + 原生按钮(作为 spec 落下去)
    expect(created.length).toBeGreaterThanOrEqual(2);
  });

  it('coll[0] 可绑定原生监听(悬浮球拖拽),$(fn) 初始化回调抛错不连坐整批', async () => {
    const h = makeHarness('sim-momo-evt');
    // 实跑:悬浮球-0613 的 `Ee=l[0]; Ee.addEventListener('mousedown',Ne)` 报
    // `Ee.addEventListener is not a function`,异常经 flush 冒出去,把卡里 12 个脚本
    // 全部判成「不兼容或执行失败」;这里锁定两点:门面有 addEventListener、回调抛错被隔离。
    const code = [
      "const l=$('<div></div>').appendTo('body');",
      "l[0].addEventListener('mousedown', function(){ warn('drag-down'); });",
      "l[0].addEventListener('touchstart', function(){}, {passive:false});",
      "$(()=>{ throw new Error('init-boom'); });",
    ].join('\n');
    await h.run(code);
    const warns = h.messages.filter((m) => m.type === 'warn').map((m) => String(m.message));
    expect(warns.some((w) => w.includes('初始化回调失败') && w.includes('init-boom'))).toBe(true);
    // 关键:整批仍然 done(此前 flush 抛错 → 沙箱连 done 都发不出去)
    expect(h.messages.some((m) => m.type === 'done')).toBe(true);
    expect(h.messages.filter((m) => m.type === 'error')).toHaveLength(0);
  });

  it('拖拽收尾:ownerDocument.defaultView / window 上的监听要绑到宿主 window', async () => {
    const h = makeHarness('sim-momo-win');
    // 实跑:悬浮球把 mousemove/mouseup 挂在 `a.ownerDocument?.defaultView ?? window` 上,
    // 原生 ownerDocument 落到沙箱自己的空窗口 ⇒ 宿主事件永不送达,面板「按下有反应、抬起没反应」。
    const code = [
      "const root=$('<div></div>').appendTo('body');",
      "const btn=document.createElement('button');",
      "root[0].appendChild(btn);",
      "const n=btn.ownerDocument?btn.ownerDocument.defaultView:null;",
      "n.addEventListener('mousemove', function(){ warn('move'); });",
      "n.addEventListener('mouseup', function(){ warn('up'); });",
      "window.addEventListener('mouseup', function(){ warn('win-up'); });",
    ].join('\n');
    const ops = await h.run(code);
    const hostWindowOn = ops.filter((o) => o.method === 'on' && o.ref?.kind === 'window');
    expect(hostWindowOn.length).toBeGreaterThanOrEqual(3);
    expect(h.messages.filter((m) => m.type === 'error')).toHaveLength(0);
  });

  it('原生节点读 getBoundingClientRect 拿到宿主真值(悬浮球拖拽抓取偏移)', async () => {
    const h = makeHarness('sim-momo-rect');
    // 两条链必须一起通:①宿主回包 mirror.rects 带 kdId 真值;②沙箱门面按 kdId 读它。
    // 缺任何一条 ⇒ 抓取偏移退化成「按下点绝对坐标」,按下瞬间球左上角被贴到光标上。
    const code = [
      "window.__ball=document.createElement('button');",
      "$('<div>').append(window.__ball).appendTo('body');",
      "window.addEventListener('mousedown', function(){",
      "  var r = window.__ball.getBoundingClientRect();",
      "  warn('left=' + r.left + ',top=' + r.top + ',w=' + r.width);",
      "});",
    ].join('\n');
    const ops = await h.run(code);
    const onOp = ops.find((o) => o.method === 'on' && o.ref?.kind === 'window');
    expect(onOp).toBeTruthy();
    h.dispatch({
      channel: 'kedai-character-script-v1',
      nonce: 'sim-momo-rect',
      type: 'jq-event',
      jqId: Number(((onOp?.args ?? []) as unknown[])[1]),
      event: { type: 'mousedown', clientX: 60, clientY: 140 },
      target: { kind: 'target', id: 0, data: {}, state: { tag: 'button', classes: [] } },
      mirror: {
        selectors: {},
        controls: [],
        rects: {
          kd1: { left: 1, top: 2, width: 3, height: 4 },
          kd2: { left: 48, top: 120, width: 38, height: 38 },
        },
      },
    });
    await new Promise((r) => setTimeout(r, 20));
    const warns = h.messages.filter((m) => m.type === 'warn').map((m) => String(m.message));
    expect(warns).toContain('left=48,top=120,w=38');
  });
  it('窗口级 jq-event 回沙箱时带坐标,且 e.target.closest 可用(悬浮球拖拽收尾)', async () => {
    const h = makeHarness('sim-momo-jqevt');
    // 实跑两连坑:①draggable 只回 {type} ⇒ clientX/clientY 为 undefined ⇒ Math.hypot 得 NaN;
    // ②事件体没有 target ⇒ e.target.closest('button') 抛 TypeError(被 warn 吞掉,表现为点了没反应)。
    const code = [
      "window.addEventListener('mouseup', function(e){",
      "  warn('evt=' + e.clientX + ',' + e.clientY + ',closest=' + String(e.target && typeof e.target.closest) + ',hit=' + !!(e.target && e.target.closest('button')));",
      '});',
    ].join('\n');
    const ops = await h.run(code);
    const onOp = ops.find((o) => o.method === 'on' && o.ref?.kind === 'window');
    expect(onOp).toBeTruthy();
    h.dispatch({
      channel: 'kedai-character-script-v1',
      nonce: 'sim-momo-jqevt',
      type: 'jq-event',
      jqId: Number(((onOp?.args ?? []) as unknown[])[1]),
      event: { type: 'mouseup', clientX: 120, clientY: 80 },
      target: { kind: 'target', id: 0, data: {}, state: { tag: 'button', classes: [] } },
      mirror: { selectors: {}, controls: [] },
    });
    await new Promise((r) => setTimeout(r, 20));
    const warns = h.messages.filter((m) => m.type === 'warn').map((m) => String(m.message));
    expect(warns.some((w) => w === 'evt=120,80,closest=function,hit=true')).toBe(true);
  });
  it('补丁兼容面:_.isPlainObject/isNil 与裸全局 getChatMessages', async () => {
    const h = makeHarness('sim-momo-compat');
    // 实跑两条 `[kedai-mvu] 事件回调出错: … is not a function` / `… is not defined`。
    const code = [
      "warn('plain=' + _.isPlainObject({a:1}) + ',' + _.isPlainObject([1]) + ',' + _.isPlainObject(null));",
      "warn('nil=' + _.isNil(null) + ',' + _.isNil(0) + ' clamp=' + _.clamp(9,0,5));",
      "warn('chat=' + typeof getChatMessages);",
    ].join('\n');
    await h.run(code);
    const warns = h.messages.filter((m) => m.type === 'warn').map((m) => String(m.message));
    expect(warns.some((w) => w === 'plain=true,false,false')).toBe(true);
    expect(warns.some((w) => w === 'nil=true,false clamp=5')).toBe(true);
    expect(warns.some((w) => w === 'chat=function')).toBe(true);
    expect(h.messages.filter((m) => m.type === 'error')).toHaveLength(0);
  });
});

// 卡脚本按钮(酒馆「脚本按钮」区):悬浮窗类卡「关闭只收面板 + 球 display:none」,
// 重开全靠 appendInexistentScriptButtons + eventOn(getButtonEvent(name))。
// 只把按钮记在沙箱内存里等于关掉就再也回不来(2026-10-29 实跑),这里锁定整条链路:
// 登记 → 上送 script-buttons → 宿主点击回投 script-button-click → 作者回调被触发。
describe('卡脚本按钮(悬浮窗开关链路)', () => {
  it('登记后上送 script-buttons;宿主回投点击后 eventOn(getButtonEvent(name)) 收到', async () => {
    const h = makeHarness('sim-buttons');
    const code = [
      "appendInexistentScriptButtons([{name:'悬浮窗开关',visible:true}]);",
      "eventOn(getButtonEvent('悬浮窗开关'), function(){ $('#reopen').css('display',''); });",
    ].join('\n');
    await h.run(code);
    const sent = h.messages.filter((m) => m.type === 'script-buttons');
    expect(sent.length).toBeGreaterThan(0);
    const buttons = sent[sent.length - 1].buttons as Array<{ name: string; visible?: boolean }>;
    expect(buttons.map((b) => b.name)).toContain('悬浮窗开关');
    expect(buttons[0].visible).toBe(true);

    const before = h.messages.filter((m) => m.type === 'batch').length;
    h.dispatch({
      channel: 'kedai-character-script-v1',
      nonce: 'sim-buttons',
      type: 'script-button-click',
      name: '悬浮窗开关',
    });
    await new Promise((r) => setTimeout(r, 20));
    // 作者回调真的执行了:它会发出 css 写入(display '')
    const newOps = h.messages
      .filter((m) => m.type === 'batch')
      .slice(before)
      .flatMap((m) => (m.ops ?? []) as Array<{ method?: string; ref?: { value?: string }; args?: unknown[] }>);
    expect(newOps.some((o) => o.method === 'css' && o.ref?.value === '#reopen')).toBe(true);
    expect(h.messages.filter((m) => m.type === 'error')).toHaveLength(0);
  });

  // 回归:沙箱 iframe 是 display:none 的不可见文档,其 realm 内 requestAnimationFrame
  // 永不回调(2026-10-29 实测:1.5s 只跑 1 帧)。所以**沙箱侧绝不能把事件派发挂到 rAF 上**
  // ——曾经这么干过一次,导致所有 jq-event 永久积压、点球/点 tab/点关闭全静默无反应。
  // 合帧只能在宿主侧(host-events.ts)做。本用例断言:三条事件全部按序同步派发。
  it('事件派发不依赖 rAF:连发三条 mousemove 全部按序到达(合帧只在宿主侧做)', async () => {
    const h = makeHarness('sim-sync-events');
    const code = [
      "$(window).on('mousemove', function(e){ warn('move ' + e.clientX); });",
    ].join('\n');
    await h.run(code);
    const onOp = h.messages
      .filter((m) => m.type === 'batch')
      .flatMap((m) => (m.ops ?? []) as Array<{ method?: string; args?: unknown[] }>)
      .find((o) => o.method === 'on');
    expect(onOp).toBeTruthy();
    const jqId = Number(((onOp?.args ?? []) as unknown[])[1]);
    const warnsBefore = h.messages.filter((m) => m.type === 'warn').length;
    for (const clientX of [10, 20, 30]) {
      h.dispatch({
        channel: 'kedai-character-script-v1',
        nonce: 'sim-sync-events',
        type: 'jq-event',
        jqId,
        event: { type: 'mousemove', clientX, clientY: 5 },
        target: { kind: 'target', id: 0, data: {}, state: { tag: 'div', classes: [] } },
        mirror: { selectors: {}, controls: [] },
      });
    }
    // 只等一个宏任务(不是一帧):rAF 在这个隐藏文档里永远不会来
    await new Promise((r) => setTimeout(r, 0));
    const moveWarns = h.messages
      .filter((m) => m.type === 'warn')
      .slice(warnsBefore)
      .map((m) => String(m.message))
      .filter((w) => w.startsWith('move '));
    expect(moveWarns).toEqual(['move 10', 'move 20', 'move 30']);
  });
});
