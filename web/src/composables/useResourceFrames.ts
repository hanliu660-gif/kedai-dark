// 远程资源卡片宿主 composable(自 ChatWindow 拆出,逻辑原样迁移):
// 卡片渲染后,父页面(带 token)经 /api/resource/proxy 取作者页面 HTML,投递给独立
// 宿主文档 /resource-frame.html(iframe src 加载,不继承父页面 CSP,作者脚本可执行;
// 宿主文档 DOM 重建触发脚本,详见其模板)。绕开作者服务器 X-Frame-Options 与 CSP 对
// srcdoc/iframe 直嵌的拦截;iframe sandbox 无 same-origin,与主页面完全隔离。
//
// reload 自举(吸血鬼卡「下载资源→进游戏界面」的关键):
// 作者页面下载完成后 location.reload(),iframe 重载回来的是空宿主文档。
// 本模块对每个框架保持常驻消息监听,收到 reload 后的 ready 即以缓存 HTML +
// 最新存储快照(resourceStore:localStorage/sessionStorage/Cache shim 持久化)
// 重新 boot——作者脚本初始化时命中快照,跳过下载页直接进游戏界面,重启 App 后仍有效。
//
// 监听器接线:宽屏按钮点击委托在 composable 挂载时自动绑定到消息画布(卡片由 v-html
// 动态注入,委托重渲染不丢),卸载自动移除;window 的 message 常驻监听由调用方
// (ChatWindow)显式接线,保持与拆出前一致的注册时序。

import { onBeforeUnmount, onMounted } from 'vue';
import type { Ref } from 'vue';
import { ApiError, apiErrorMessage, authorizedFetch, BASE } from '../api/client';
import { getCharacter } from '../api/characters';
import type { CharacterRecord } from '../api/types';
import { applyResourceSync, loadResourceSnapshot, type ResourceSyncMessage } from '../resourceStore';
import { allowResourceDomain, isResourceDomainAllowed, resourceDomainOf } from '../resourceDomains';
import { inlineCardPayload } from '../inlineCardRegistry';
import { clearScriptErrorNotices } from '../render';

/** 卡片说明区默认文案(与 render.ts::buildRemoteResourceHtml 的初值同源,单处维护) */
const DEFAULT_RESOURCE_NOTE =
  '资源页面由角色卡作者提供,已隔离加载;若未显示,请使用上方链接在新窗口打开。';

/**
 * FE-5 C(2026-10-06 R1 裁决):TavernHelper.generate 的节流与上限。
 *
 * 资源页是**不可信的第三方代码**,generate 消耗用户额度(经宿主带 token 转发
 * /api/chat/generate-raw)。正常卡片(吸血鬼卡等)的开场白/总结是个人规模调用,
 * 门槛取「够用但不失控」:60s 滑动窗口内最多 6 次;单框架生命周期最多 120 次
 * (reload 自举不重置计数——同一卡反复重生成也会触顶)。超限回**显式 error**:
 * 作者页的 await 得到 reject,不再静默挂起。
 */
const TAVERN_CALL_WINDOW_MS = 60_000;
const TAVERN_CALL_WINDOW_MAX = 6;
const TAVERN_CALL_TOTAL_MAX = 120;
const TAVERN_CALL_THROTTLED = '资源页生成调用过于频繁(已限流)';

export interface UseResourceFramesOptions {
  /** 消息画布滚动容器(RenderPanelHost 根元素;卡片 DOM 扫描与宽屏点击委托的挂载点) */
  scrollArea: Ref<HTMLElement | null>;
  /** 当前角色详情(boot 时随快照下发卡元数据与世界书) */
  currentCharacter: Ref<CharacterRecord | null>;
  /** 当前角色 id(TavernHelper RPC 转发生成时的 character_id) */
  currentCharacterId: Ref<string | null>;
  /**
   * 当前会话的 MVU 变量树(可选)。酒馆整页卡把 `window.Mvu` 当环境就绪判据:
   * 缺了它只渲染静态开场(「未能读取档案:检测到缺少MVU」)。变量真身在 chat store,
   * boot 时下发给框架做只读快照。
   */
  mvuVariables?: Ref<MvuVarsSnapshot | null>;
  /** 框架内脚本调用 Mvu.replaceMvuData 时回写宿主(不传则框架内改动只留在文档里) */
  onMvuReplace?: (data: MvuVarsSnapshot) => void;
  /**
   * 当前会话消息(可选)。实证:整页前端卡需要「按楼层读变量」——
   * 露出日记卡的初始化是 `getChatMessages(getCurrentMessageId())[0].data.stat_data`,
   * 没有这个 RPC 就直接 ReferenceError/空数据,Vue 应用不挂载。
   * 只读用途:不回写、不暴露世界书写入口。
   */
  messages?: Ref<Array<{ id: string | number; role: string; content: string }>>;
  /**
   * 框架内脚本要「往聊天里发一条用户消息并开始一轮生成」时回调(可选)。
   *
   * 实测来源:「露出日记-0615」数据录入向导的「完成确认」——
   * `await createChatMessages([{role:'user',message:'开始游戏'}]); triggerSlash('/trigger')`。
   * 酒馆里这两个是裸全局并直接开一轮生成;Kedai 的对话推进只能在宿主 store 里做,
   * 因此框架先把正文暂存、收到 /trigger 时把暂存正文交给宿主发送(不传则拒绝并回错,
   * 避免作者页以为已经发出去了)。
   */
  onCardSend?: (text: string) => void;
}

/** MVU 变量树快照(stat_data 为用户可见状态,display_data 为展示层) */
export interface MvuVarsSnapshot {
  stat_data: Record<string, unknown>;
  display_data: Record<string, unknown>;
}

interface ResourceEntry {
  url: string;
  nonce: string;
  frame: HTMLIFrameElement;
  /**
   * 整页脚本卡的内联文档 nonce(来自 render.ts::buildInlineCardHtml 的壳)。
   * 置位表示 HTML 不是从作者服务器抓的,而是角色卡正则脚本产出的完整文档,
   * 正文由 inlineCardRegistry 暂存、此处直接投递。
   */
  inlineNonce?: string;
  /** 框架内 createChatMessages 暂存的正文,等 /trigger 时一并交给宿主发送(见 onCardSend) */
  pendingCardTexts?: string[];
  /** 当前文档代数是否已成功投递 boot(reload 后 ready 会复位为 false) */
  booted: boolean;
  /** 代理拉取连续失败次数(退避重试用,成功投递后清零) */
  attempts: number;
  /** nonce 丢失修复次数(防重建循环) */
  repairs: number;
  /** 已受理的 tavern-call 时间戳(滑动窗口限流用,见 TAVERN_CALL_WINDOW_MS) */
  callStamps: number[];
  /** 已受理的 tavern-call 累计数(生命周期上限用;reload 不重置) */
  callCount: number;
}

/** iframe srcdoc 注入用:HTML 属性转义(资源页原文仅作 srcdoc 字符串,不拼接进本页面) */
function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * 资源页 RPC 诊断日志(环形保留 20 条,localStorage)。
 * 卡片自检报「丢格式」时,用 `injected`(世界书注入条数)与 `chars`(产出长度)
 * 区分故障:injected=0 → 角色 id 未送达或条目未命中;chars 偏小 → 被 max_tokens 截断。
 * 仅记元信息,不落正文/密钥。
 */
function logTavernCall(entry: Record<string, unknown>): void {
  try {
    const log = JSON.parse(localStorage.getItem('kedai.tavern-call-log') ?? '[]') as unknown[];
    log.push({ t: Date.now(), ...entry });
    localStorage.setItem('kedai.tavern-call-log', JSON.stringify(log.slice(-20)));
  } catch {
    /* 忽略(隐私模式/配额满) */
  }
}

/**
 * 把可能带 Vue 代理/循环引用的对象转成可结构化克隆的纯数据。
 * postMessage 的 structuredClone 遇到 Proxy 会抛 DataCloneError,必须先序列化。
 */
function sanitizePlaneObject(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object') return {};
  const parsed: unknown = JSON.parse(JSON.stringify(input));
  return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
}

export function useResourceFrames(opts: UseResourceFramesOptions) {
  /** 已注册的资源框架:contentWindow(跨 reload 稳定)→ 条目 */
  const resourceFrames = new Map<Window, ResourceEntry>();
  /** 作者页面 HTML 按 URL 缓存(同一作者页多条消息共享;失败不缓存,便于重试) */
  const resourceHtmlCache = new Map<string, Promise<{ html: string; base_url?: string }>>();

  /**
   * 取作者页 HTML。**成败按 HTTP 状态判定**(批次 1):后端错误体已统一为
   * `{error, code}` + 真实状态码,不再用 200 + `{ok:false}` 上报失败——若仍按
   * `body.ok` 分支,失败会被当成「html 缺失」而丢掉后端给的错误文案与 code 分类。
   */
  function fetchResourceHtml(url: string): Promise<{ html: string; base_url?: string }> {
    let p = resourceHtmlCache.get(url);
    if (!p) {
      p = (async () => {
        const res = await authorizedFetch(`${BASE}/resource/proxy?url=${encodeURIComponent(url)}`, undefined, false);
        const body = (await res.json().catch(() => ({}))) as { html?: unknown; base_url?: unknown; error?: unknown; code?: unknown };
        if (!res.ok) {
          const detail = typeof body.error === 'string' ? body.error : undefined;
          const code = typeof body.code === 'string' ? body.code : undefined;
          throw new ApiError(res.status, code, detail, apiErrorMessage(res.status, code, detail));
        }
        if (typeof body.html !== 'string') throw new Error('资源页响应缺少 html');
        return { html: body.html, base_url: typeof body.base_url === 'string' ? body.base_url : undefined };
      })();
      resourceHtmlCache.set(url, p);
      const drop = (): void => {
        if (resourceHtmlCache.get(url) === p) resourceHtmlCache.delete(url);
      };
      p.catch(drop);
    }
    return p;
  }

  /** 向框架投递 boot(HTML + 存储快照);失败退避重试,超过 3 次在卡片说明区给「重试」按钮 */
  async function bootResourceFrame(entry: ResourceEntry): Promise<void> {
    const { frame, nonce, url } = entry;
    if (!frame.isConnected) return;
    const win = frame.contentWindow;
    if (!win) return;
    try {
      // 整页脚本卡:正文来自渲染期登记的内联文档(no fetch,作者服务器不参与);
      // 登记表因容量淘汰而缺失时不下发,等下次渲染/hydrate 重试。
      let html: string;
      if (entry.inlineNonce) {
        const payload = inlineCardPayload(entry.inlineNonce);
        if (!payload) return;
        html = payload.html;
      } else {
        const body = await fetchResourceHtml(url);
        html = body.base_url ? `<base href="${escapeAttr(body.base_url)}">\n${body.html}` : body.html;
      }
      const snapshot = await loadResourceSnapshot(url);
      // 酒馆助手式资源页需要当前角色卡元数据推导资源包口令(TavernHelper shim)
      const ch = opts.currentCharacter.value;
      const charData = ch
        ? {
            name: ch.chara_name || ch.name,
            creator: ch.creator ?? null,
            character_version: ch.character_version ?? null,
            creator_notes: ch.creator_notes ?? null,
          }
        : null;
      // 世界书随 boot 下发:作者页 getCharWorldbookNames 是同步接口,走不了 postMessage
      // RPC,只能预发数据由 shim 读内存(吸血鬼卡的开局消息/设定在世界书条目里)。
      // 体积保护:超 512KB 不下发(世界书巨大时作者页按无世界书容错,界面仍可运行)。
      // 注意:角色列表接口不带 data_raw(体积大,仅详情返回),worldbook 提取必须先
      // 拉详情兜底——否则开局消息/设定永远缺失(实测卡死在游戏 home)。
      let worldbook: { name: string; entries: unknown[] } | null = null;
      let rawBook = (ch?.data_raw as Record<string, unknown> | undefined)?.character_book as
        | { name?: string; entries?: unknown[] }
        | undefined;
      if (!rawBook && ch?.id) {
        try {
          const detail = await getCharacter(ch.id);
          rawBook = (detail?.data_raw as Record<string, unknown> | undefined)?.character_book as
            | { name?: string; entries?: unknown[] }
            | undefined;
        } catch {
          /* 详情拉取失败:按无世界书继续 */
        }
      }
      if (rawBook?.name && Array.isArray(rawBook.entries) && rawBook.entries.length > 0) {
        const candidate = { name: rawBook.name, entries: rawBook.entries };
        try {
          if (JSON.stringify(candidate).length <= 512 * 1024) worldbook = candidate;
        } catch {
          /* 循环引用等异常:不下发 */
        }
      }
      // MVU 变量快照:框架内 window.Mvu 读它就够了;写回见 mvu-replace 上行。
      // 必须转成纯 JSON 再投递——pinia ref 里是 Vue 响应式代理,直接 postMessage 会
      // 抛 DataCloneError(#<Object> could not be cloned),整条 boot 失败、卡片空白。
      let mvuSnapshot: MvuVarsSnapshot | null = null;
      const rawMvu = opts.mvuVariables?.value;
      if (rawMvu) {
        try {
          mvuSnapshot = {
            stat_data: sanitizePlaneObject(rawMvu.stat_data),
            display_data: sanitizePlaneObject(rawMvu.display_data),
          };
        } catch {
          mvuSnapshot = null; // 循环引用等异常:按无变量继续 boot
        }
      }
      win.postMessage(
        {
          channel: 'kedai-resource-frame-v1',
          nonce,
          type: 'boot',
          html,
          snapshot,
          charData,
          worldbook,
          mvu: mvuSnapshot,
        },
        '*',
      );
      entry.booted = true;
      entry.attempts = 0;
      entry.repairs = 0;
      // 卡片界面已由隔离文档接管:气泡里若还留着沙箱兼容执行器挂的「[脚本] …」失败提示,
      // 它描述的那次尝试已经不再成立(卡在框架里正常渲染),清掉免得用户看到假故障。
      clearStaleScriptErrorNotice(frame);
    } catch (e) {
      entry.attempts += 1;
      if (entry.attempts <= 3) {
        const delay = 1500 * entry.attempts;
        setTimeout(() => {
          if (!entry.booted && frame.isConnected) void bootResourceFrame(entry);
        }, delay);
      } else if (!entry.booted) {
        showResourceError(entry, String((e as Error).message || '网络错误'));
      }
    }
  }

  /** 加载失败的可见反馈:说明区追加「重试」(iframe 内仍是宿主模板文档,重试即重新 boot,无需重建框架) */
  /**
   * 清掉同一条消息里「沙箱兼容执行器」残留的脚本失败提示。
   * 整页脚本卡的 HTML 交给隔离文档后,沙箱那次镜像执行必然失败(拿不到真实 DOM),
   * 而卡本身已经在框架里跑起来了——那条红字属假故障,用户会以为卡没修好。
   */
  function clearStaleScriptErrorNotice(frame: HTMLIFrameElement): void {
    const scope = frame.closest('[data-kd-scope]') ?? frame.parentElement;
    if (!scope) return;
    clearScriptErrorNotices(scope);
  }

  function showResourceError(entry: ResourceEntry, message: string): void {
    const card = entry.frame.closest('[data-kd-resource="1"]');
    const note = card?.querySelector<HTMLElement>('.sv-resource-card-note');
    if (!note) return;
    note.textContent = `资源界面加载失败:${message}。`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sv-btn ghost sv-btn-sm';
    btn.textContent = '重试';
    btn.onclick = () => {
      note.textContent = DEFAULT_RESOURCE_NOTE;
      entry.attempts = 0;
      entry.booted = false;
      void bootResourceFrame(entry);
    };
    note.appendChild(btn);
  }

  /**
   * FE-5 A(2026-10-06 R1 裁决):首次遇新域名的**一次性确认**。
   *
   * 未确认的域名不注册框架、不预拉取(不触碰作者服务器),只在卡片说明区就地
   * 加一个确认按钮;用户确认后把域名记进本机白名单并重跑 hydrate(幂等)。
   * 「在新窗口打开」链接不受影响(T1 既有裁决的兼容面保留)。
   */
  function showResourceDomainConfirm(frame: HTMLIFrameElement, url: string): void {
    const card = frame.closest('[data-kd-resource="1"]') as HTMLElement | null;
    const note = card?.querySelector<HTMLElement>('.sv-resource-card-note');
    const host = resourceDomainOf(url) ?? url;
    if (!card || !note) return;
    // 幂等闩锁:重渲染/重复扫描不叠第二个按钮
    if (card.dataset.kdDomainPending === host) return;
    card.dataset.kdDomainPending = host;
    note.textContent = `资源界面来自 ${host}:加载将在隔离沙箱内执行该站点的脚本,首次需确认。`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sv-btn ghost sv-btn-sm';
    btn.textContent = '加载此域名';
    btn.onclick = () => {
      allowResourceDomain(url);
      delete card.dataset.kdDomainPending;
      note.textContent = DEFAULT_RESOURCE_NOTE;
      void hydrate();
    };
    note.appendChild(btn);
  }

  /** 常驻消息分发:ready(首载/reload 自举)、store-sync(shim 持久化桥) */
  function handleMessage(ev: MessageEvent): void {
    const m = ev.data as
      | ({ channel?: string; nonce?: string; type?: string; callId?: string; method?: string } & Partial<ResourceSyncMessage>)
      | null;
    if (!m || m.channel !== 'kedai-resource-frame-v1') return;
    const entry = resourceFrames.get(ev.source as Window);
    if (!entry) {
      // FE-5 C:认不出的来源以前是**静默丢帧**——作者页 await TavernHelper.generate
      // 会一直悬挂(身份不匹配时整条上行通道全哑,如 WebView2 包装 event.source)。
      // 改为尽力回显式 error:回包由宿主窗口发出,满足模板侧 `event.source ===
      // REAL_PARENT` 校验;模板 handleTavernResult 只按 callId 路由、不校验 nonce,
      // 故不依赖来源身份也能送达。回包失败(跨源对象不可 postMessage)才退化为
      // 模板侧 120s 超时兜底。
      if (m.type === 'tavern-call' && typeof m.callId === 'string') {
        logTavernCall({ phase: 'unmatched', callId: m.callId, method: m.method ?? null });
        try {
          (ev.source as Window | null)?.postMessage?.(
            {
              channel: 'kedai-resource-frame-v1',
              type: 'tavern-result',
              callId: m.callId,
              ok: false,
              error: '资源页会话未授权或已失效',
            },
            '*',
          );
        } catch {
          /* 跨源对象不可回包:保持静默(退化到模板超时) */
        }
      }
      return;
    }
    if (m.type === 'ready') {
      if (m.nonce === entry.nonce) {
        // 首次加载或作者页面 reload 自举:新文档需要重新 boot(携带最新快照)
        entry.booted = false;
        void bootResourceFrame(entry);
      } else if (!m.nonce && entry.repairs < 2 && entry.frame.isConnected) {
        // nonce 丢失的重载(window.name 被作者页面覆写等):重建 src 恢复 hash 里的 nonce
        entry.repairs += 1;
        entry.frame.removeAttribute('srcdoc');
        entry.frame.src = `/resource-frame.html#${encodeURIComponent(entry.nonce)}`;
      }
      return;
    }
    if (m.nonce !== entry.nonce) return;
    if (m.type === 'store-sync') {
      applyResourceSync(entry.url, m as ResourceSyncMessage);
      return;
    }
    if (m.type === 'tavern-call') {
      void handleTavernCall(entry, m as { callId?: string; method?: string; args?: unknown });
      return;
    }
    if (m.type === 'mvu-replace') {
      // 框架内 Mvu.replaceMvuData:变量真身在 host chat store,这里同步落库
      const data = (m as { data?: unknown }).data;
      if (data && typeof data === 'object') opts.onMvuReplace?.(data as MvuVarsSnapshot);
      return;
    }
    if (m.type === 'kd-error') {
      // 框架内作者脚本的运行时异常:跨源读不到 iframe 的控制台,只能由框架侧上报。
      // 只打印不落库(不含正文/变量,只有栈与消息),供「界面空白」时定位。
      const detail = m as { kind?: unknown; message?: unknown };
      const what = typeof detail.kind === 'string' ? detail.kind : 'error';
      const text = typeof detail.message === 'string' ? detail.message : '';
      if (text) console.warn(`[资源页脚本] ${what}: ${text}`);
      return;
    }
    if (m.type === 'height') {
      // 整页卡是自然高度的长页,固定 520px 会截断;按文档上报的高度自适应。
      // 宽屏态由 CSS flex 撑满,不受这里的 inline height 影响(裁剪在 120~4000 之外的异常值)
      const h = Number((m as { height?: unknown }).height);
      if (Number.isFinite(h) && h >= 120) {
        const clamped = Math.min(Math.round(h), 4000);
        if (entry.frame.dataset.kdContentHeight !== String(clamped)) {
          entry.frame.dataset.kdContentHeight = String(clamped);
          entry.frame.style.height = `${clamped}px`;
        }
      }
    }
  }

  /**
   * TavernHelper RPC 桥:沙箱 iframe 内作者脚本(吸血鬼卡等)调 TavernHelper.generate
   * 生成开场白/总结;iframe 无 token,经宿主转发 /api/chat/generate-raw(一次性非流式)。
   * 作者页参数形态:{user_input, injects:[{role,content,position}], overrides:{chat_history:{prompts}}}
   * —— 组装为扁平 messages:chat_history.prompts + in_chat injects + user_input。
   */
  /**
   * 酒馆 getChatMessages 的宿主实现(只读)。
   * 酒馆消息对象的关键字段:`message_id` / `role` / `message` / `data`;
   * 整页卡从 `data.stat_data` 里取 MVU 变量树,故把当前会话变量快照挂到每条消息上
   * (kedai 的 MVU 变量本就是会话级一份,不做按楼层分叉,语义等同)。
   * ids 支持:单 id、id 数组、楼层序号(数字)、'latest';缺省/null 返回全部。
   */
  function readChatMessages(args: unknown): Array<Record<string, unknown>> {
    const snapshot = {
      stat_data: sanitizePlaneObject(opts.mvuVariables?.value?.stat_data ?? {}),
      display_data: sanitizePlaneObject(opts.mvuVariables?.value?.display_data ?? {}),
    };
    const list = opts.messages?.value ?? [];
    const rows = list.map((msg, index) => ({
      message_id: msg.id,
      id: msg.id,
      role: msg.role,
      name: msg.role === 'user' ? 'user' : 'character',
      message: msg.content,
      content: msg.content,
      data: JSON.parse(JSON.stringify(snapshot)) as Record<string, unknown>,
      index,
    }));
    const raw = Array.isArray(args) ? args[0] : args;
    const ids: unknown[] = Array.isArray(raw) ? raw : [raw];
    if (ids.length === 0 || ids[0] === null || ids[0] === undefined) return rows;
    const picked: Array<Record<string, unknown>> = [];
    for (const id of ids) {
      if (typeof id === 'string' && id === 'latest') {
        const last = rows[rows.length - 1];
        if (last) picked.push(last);
        continue;
      }
      if (typeof id === 'number') {
        const byIndex = rows[id];
        if (byIndex) picked.push(byIndex);
        continue;
      }
      const hit = rows.find((r) => r.id === id);
      if (hit) picked.push(hit);
    }
    return picked;
  }

  async function handleTavernCall(
    entry: ResourceEntry,
    m: { callId?: string; method?: string; args?: unknown },
  ): Promise<void> {
    // 调试痕迹:资源页 RPC 调用记录(桥入口先记一条,便于确认调用是否到达宿主)
    logTavernCall({ method: m.method, callId: m.callId, phase: 'received' });
    const win = entry.frame.contentWindow;
    if (!win || !m.callId) return;
    const reply = (ok: boolean, value?: unknown, error?: string): void => {
      win.postMessage(
        { channel: 'kedai-resource-frame-v1', nonce: entry.nonce, type: 'tavern-result', callId: m.callId, ok, value, error },
        '*',
      );
    };
    // 读消息(酒馆 getChatMessages):整页前端卡用它把「当前楼层 + 该楼层的变量树」
    // 读出来初始化界面(露出日记卡:`getChatMessages(getCurrentMessageId())[0].data.stat_data`)。
    // kedai 的 MVU 变量是会话级一份,这里把当前快照挂到每条消息的 data 上,与
    // TavernHelper.generate 的变量语义一致;不含世界书/正文改写,纯只读。
    if (m.method === 'getChatMessages') {
      reply(true, readChatMessages(m.args));
      return;
    }
    // 整页前端卡「先落消息、再触发生成」的两步(酒馆同款裸全局,见 installStGlobals):
    // createChatMessages 只暂存正文,收到 /trigger 才真正交给宿主发起一轮生成。
    if (m.method === 'createChatMessages') {
      const list = Array.isArray(m.args) ? m.args : [];
      const staged: string[] = [];
      for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const rec = item as { role?: unknown; message?: unknown };
        const text = typeof rec.message === 'string' ? rec.message.trim() : '';
        if (text && (rec.role === undefined || rec.role === 'user')) staged.push(text);
      }
      entry.pendingCardTexts = staged;
      reply(true, null);
      return;
    }
    if (m.method === 'triggerSlash') {
      const command = typeof m.args === 'string' ? m.args.trim() : '';
      const pending = (entry.pendingCardTexts ?? []).join('\n');
      entry.pendingCardTexts = [];
      if (!/^\/(trigger|gen|generate|continue)\b/i.test(command)) {
        // 其余 slash 指令 Kedai 没有对应实现:明确拒绝,别让作者页以为执行成功
        reply(false, undefined, `Kedai 未实现该指令:${command || '(空)'}`);
        return;
      }
      if (!opts.onCardSend) {
        reply(false, undefined, '当前界面不支持从角色卡发起对话');
        return;
      }
      if (!pending) {
        // 没有暂存正文(重复点确认 / 只调 /trigger):按幂等处理,不重复开一轮生成
        reply(true, null);
        return;
      }
      opts.onCardSend(pending);
      reply(true, null);
      return;
    }
    if (m.method !== 'generate') {
      reply(false, undefined, `不支持的调用:${m.method}`);
      return;
    }
    // FE-5 C:限流在组装参数/发起上游请求**之前**判定(超限调用不消费任何上游资源)
    const now = Date.now();
    entry.callStamps = entry.callStamps.filter((t) => now - t < TAVERN_CALL_WINDOW_MS);
    if (entry.callStamps.length >= TAVERN_CALL_WINDOW_MAX || entry.callCount >= TAVERN_CALL_TOTAL_MAX) {
      logTavernCall({ method: m.method ?? 'generate', callId: m.callId, ok: false, error: 'throttled' });
      reply(false, undefined, TAVERN_CALL_THROTTLED);
      return;
    }
    entry.callStamps.push(now);
    entry.callCount += 1;
    try {
      const a = (m.args ?? {}) as {
        user_input?: string;
        injects?: Array<{ role?: string; content?: string; position?: string }>;
        overrides?: { chat_history?: { prompts?: Array<{ role?: string; content?: string }> } };
        /** 模板侧并入的预设提示词(作者页 replacePreset 注入的防掉格式提示等),位于历史之后、注入之前 */
        __preset_prompts?: Array<{ role?: string; content?: string }>;
      };
      const messages: Array<{ role: string; content: string }> = [];
      for (const p of a.overrides?.chat_history?.prompts ?? []) {
        if (p?.role && typeof p.content === 'string') messages.push({ role: p.role, content: p.content });
      }
      for (const p of a.__preset_prompts ?? []) {
        if ((p?.role === 'user' || p?.role === 'system') && typeof p.content === 'string') {
          messages.push({ role: p.role, content: p.content });
        }
      }
      for (const inj of a.injects ?? []) {
        if (inj?.role === 'system' && typeof inj.content === 'string') {
          messages.push({ role: 'system', content: inj.content });
        }
      }
      if (typeof a.user_input === 'string' && a.user_input.trim()) {
        messages.push({ role: 'user', content: a.user_input });
      }
      if (messages.length === 0) {
        reply(false, undefined, '消息列表为空');
        return;
      }
      const res = await authorizedFetch(`${BASE}/chat/generate-raw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // character_id 触发后端世界书匹配注入(对齐酒馆 generate 语义):
        // 作者页只自组历史与 user_input,世界书关键字命中(如吸血鬼卡 "system log"
        // 触发的输出格式规范)由后端注入,缺失会让模型自由发挥 → 游戏自检「丢格式」
        body: JSON.stringify({ messages, character_id: opts.currentCharacterId.value ?? undefined }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        text?: string;
        error?: string;
        /** 后端注入的世界书条目 comment 清单,空数组/缺失即「未注入」 */
        injected?: string[];
      };
      if (data.ok && typeof data.text === 'string') {
        // 注入条数与产出长度写进诊断日志(卡片报「丢格式」时用于区分
        // 「世界书没注入」与「JSON 被 max_tokens 截断」两种故障)
        logTavernCall({
          method: m.method ?? 'generate',
          callId: m.callId,
          ok: true,
          injected: data.injected?.length ?? 0,
          chars: data.text.length,
          characterId: opts.currentCharacterId.value ?? null,
        });
        reply(true, data.text);
      } else {
        logTavernCall({
          method: m.method ?? 'generate',
          callId: m.callId,
          ok: false,
          error: data.error ?? `HTTP ${res.status}`,
          characterId: opts.currentCharacterId.value ?? null,
        });
        reply(false, undefined, data.error ?? `HTTP ${res.status}`);
      }
    } catch (e) {
      reply(false, undefined, String((e as Error).message || '桥接失败'));
    }
  }

  /** 资源卡片扫描与接线:新出现的 iframe 注册条目并预拉取作者页(幂等,kdWired 闩锁) */
  async function hydrate(): Promise<void> {
    if (!opts.scrollArea.value) return;
    // 清理已从 DOM 移除的框架条目(消息删除/虚拟滚动卸载),防 map 泄漏
    for (const [win, entry] of resourceFrames) {
      if (!entry.frame.isConnected) resourceFrames.delete(win);
    }
    const frames = opts.scrollArea.value.querySelectorAll<HTMLIFrameElement>('iframe[data-kd-resource-frame="1"]');
    for (const frame of frames) {
      if (frame.dataset.kdWired) continue;
      const card = frame.closest('[data-kd-resource="1"]') as HTMLElement | null;
      const nonce = card?.dataset.kdResourceNonce;
      if (!card || !nonce) continue;
      // 整页脚本卡(角色卡正则脚本产出的完整文档):无 URL,正文由渲染期登记;
      // 远程资源卡:有 data-kd-resource-url,需过域名白名单再预拉取。
      const inlineNonce = card.dataset.kdInlineNonce;
      let url: string;
      if (inlineNonce) {
        url = `inline:${inlineNonce}`;
      } else {
        const rawUrl = card.dataset.kdResourceUrl;
        if (!rawUrl) continue;
        url = decodeURIComponent(rawUrl);
        // FE-5 A:未确认的域名不注册框架、不预拉取(只在卡片内就地确认,见 showResourceDomainConfirm)
        if (!isResourceDomainAllowed(url)) {
          showResourceDomainConfirm(frame, url);
          continue;
        }
      }
      const win = frame.contentWindow;
      if (!win) {
        // iframe 宿主文档尚未加载完成(contentWindow 为 null):延迟重试,
        // 不依赖 load 事件(load 可能先于监听触发或 lazy 加载延后,导致永不被投递)。
        // 每 300ms 重试,最多 50 次(15s);期间 kdWired 未标记,超时后放弃(卡片留有"新窗口打开"兜底)。
        const retry = (attempt: number): void => {
          if (frame.dataset.kdWired || !frame.isConnected) return;
          if (frame.contentWindow) {
            void hydrate();
          } else if (attempt < 50) {
            setTimeout(() => retry(attempt + 1), 300);
          }
        };
        setTimeout(() => retry(1), 300);
        continue;
      }
      frame.dataset.kdWired = '1';
      const entry: ResourceEntry = {
        url,
        nonce,
        frame,
        inlineNonce,
        booted: false,
        attempts: 0,
        repairs: 0,
        callStamps: [],
        callCount: 0,
      };
      resourceFrames.set(win, entry);
      // 预拉取作者页面 HTML(与模板加载并行;失败不缓存,boot 分支会退避重试)。
      // 整页脚本卡不需要网络,正文在渲染期已登记。
      if (!inlineNonce) void fetchResourceHtml(url).catch(() => undefined);
      // ready 可能先于常驻监听注册(模板加载很快):超时兜底直接投递,
      // 宿主文档 booted 闩锁只接受第一条 boot,重复投递无害。
      // 12s 覆盖代理下载大资源页(如吸血鬼卡 1.25MB)+ 宿主文档重建时间。
      setTimeout(() => {
        if (!entry.booted && frame.isConnected) void bootResourceFrame(entry);
      }, 12000);
    }
  }

  /**
   * 资源卡片宽屏切换(吸血鬼卡等的游戏界面为全屏设计):作者页往父文档注入撑满
   * 样式在沙箱下必抛 SecurityError(模板已装 parent shim 让作者页切入宽屏态),
   * 视口撑满由宿主侧把整卡 fixed 撑满补足。走消息画布上的事件委托,重渲染不丢。
   */
  function onWideClick(e: MouseEvent): void {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-kd-resource-wide="1"]');
    if (!btn || !opts.scrollArea.value?.contains(btn)) return;
    const card = btn.closest<HTMLElement>('[data-kd-resource="1"]');
    if (!card) return;
    const wide = card.dataset.kdWide !== '1';
    card.dataset.kdWide = wide ? '1' : '';
    btn.textContent = wide ? '退出宽屏' : '宽屏';
  }

  // 宽屏按钮点击委托:挂载时绑定到消息画布(卡片由 v-html 注入),卸载自动移除
  onMounted(() => {
    opts.scrollArea.value?.addEventListener('click', onWideClick);
  });
  onBeforeUnmount(() => {
    opts.scrollArea.value?.removeEventListener('click', onWideClick);
  });

  return {
    /** 扫描画布内资源卡片 iframe 并完成接线/投递(重复调用幂等) */
    hydrate,
    /** 常驻 window message 分发(ready / store-sync / tavern-call),由调用方接线 */
    handleMessage,
  };
}
