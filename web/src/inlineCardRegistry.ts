// 整页脚本卡(酒馆「前端渲染」卡)的文档缓冲。
//
// 背景:这类角色卡的正则脚本把整段开场白替换成**一份完整 HTML 文档 + 它自己的
// `<script>`**,界面由脚本在运行时装配(`document.getElementById` 取节点、
// `classList` 切页、监听按钮)。它们在酒馆里能跑,是因为 HTML 与脚本处在同一个
// 真实文档里;kedai 早期把脚本抽到镜像沙箱执行,`getElementById` 只能拿到无事件的
// 门面对象,`addEventListener` 直接 TypeError,界面永远装配不出来。
//
// 处置:渲染侧只产出 iframe 壳(见 render.ts::buildInlineCardHtml),文档正文在这里
// 按 nonce 暂存;useResourceFrames.hydrate 扫描到该壳后取出正文,经 postMessage
// 投递给 /resource-frame.html(独立文档、真实 DOM、脚本照常执行)。
//
// 为什么不把文档塞进 DOM 属性:正文可达 700KB 级,属性化会让每次 v-html 替换都复制
// 一遍巨型字符串,且 HTML 转义成本翻倍;Map 里只存一份。
//
// 容量:每个条目最多几百 KB,故只保留最近 MAX_ENTRIES 条(按插入顺序淘汰),
// 消息滚出视口后对应的壳被卸载,再滚回来会重新渲染并重新登记,不会缺内容。

export interface InlineCardPayload {
  /** 完整 HTML 文档原文(已剥 markdown 代码围栏) */
  html: string;
}

/** 保留条目上限(按最近使用淘汰;32 条足够覆盖单个会话内可见的界面卡) */
const MAX_ENTRIES = 32;

const payloads = new Map<string, InlineCardPayload>();

/** 登记一份待投递的整页文档(nonce 与 iframe 壳的 data 属性同源) */
export function registerInlineCard(nonce: string, html: string): void {
  if (!nonce || typeof html !== 'string' || !html) return;
  // 先删后插:命中的条目移到队尾,淘汰时优先丢弃未再被渲染的旧文档
  payloads.delete(nonce);
  payloads.set(nonce, { html });
  while (payloads.size > MAX_ENTRIES) {
    const oldest = payloads.keys().next();
    if (oldest.done) break;
    payloads.delete(oldest.value);
  }
}

/** 取文档正文(投递后不删除:消息画布重渲染/iframe reload 自举都要再投一次) */
export function inlineCardPayload(nonce: string): InlineCardPayload | undefined {
  return payloads.get(nonce);
}

/** 清空缓冲(测试与切卡时使用) */
export function resetInlineCards(): void {
  payloads.clear();
}
