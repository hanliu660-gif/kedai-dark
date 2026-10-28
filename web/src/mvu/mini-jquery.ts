// 极简 jQuery 子集:供 mvu 状态栏脚本(角色卡内嵌)在注入容器内使用。
// 支持:选择器(#id/.cls/tag/后代/:first/:last)、on('click')、text/html/css、
//       addClass/removeClass/data、$(callback) ready 回调、val。
// 查询一律限定在当前激活的注入容器(setJQueryRoot)内,避免跨消息串扰。
// 脚本环境约定兼容 MagVarUpdate 生态(原作者:MagicalAstrogy,github.com/MagicalAstrogy/MagVarUpdate,MIT)。

type JqCallback = () => void;
let currentRoot: Element | null = null;
const readyQueue: JqCallback[] = [];

export function setJQueryRoot(root: Element | null): void {
  currentRoot = root;
}

/** 注册容器挂载后执行的回调(等效 jQuery ready) */
export function onJqReady(fn: JqCallback): void {
  readyQueue.push(fn);
}

/** 容器挂载后调用:flush ready 回调并等待其完成(async 脚本需保持变量上下文) */
export async function flushJqReady(): Promise<void> {
  const q = readyQueue.splice(0);
  for (const fn of q) {
    try {
      await fn();
    } catch (e) {
      console.warn('[kedai-jq] ready 回调失败', e);
    }
  }
}

interface JqCollection {
  length: number;
  on(event: string, fn: (this: Element, ev: Event) => void): JqCollection;
  text(v?: string): JqCollection | string;
  html(v?: string): JqCollection | string;
  css(prop: string | Record<string, string>, val?: string): JqCollection | string;
  addClass(c: string): JqCollection;
  removeClass(c: string): JqCollection;
  hasClass(c: string): boolean;
  data(key: string): string | undefined;
  val(v?: string): JqCollection | string;
  each(fn: (this: Element, i: number, el: Element) => void): JqCollection;
  hide(): JqCollection;
  show(): JqCollection;
  filter(sel: string | ((this: Element, i: number, el: Element) => boolean)): JqCollection;
  find(sel: string): JqCollection;
  closest(sel: string): JqCollection;
  eq(i: number): JqCollection;
  first(): JqCollection;
  last(): JqCollection;
  is(sel: string): boolean;
  attr(name: string, v?: string): JqCollection | string | null;
  prop(name: string, v?: unknown): JqCollection | unknown;
  append(content: string | Element): JqCollection;
  remove(): JqCollection;
  empty(): JqCollection;
  trigger(ev: string): JqCollection;
  click(fn?: (this: Element, ev: Event) => void): JqCollection;
  [index: number]: Element;
}

const coll: JqCollection = {
  length: 0,
  on() {
    return this;
  },
  text() {
    return '';
  },
  html() {
    return '';
  },
  css() {
    return '';
  },
  addClass() {
    return this;
  },
  removeClass() {
    return this;
  },
  hasClass() {
    return false;
  },
  data() {
    return undefined;
  },
  val() {
    return '';
  },
  each() {
    return this;
  },
  hide() {
    return this;
  },
  show() {
    return this;
  },
  filter() {
    return this;
  },
  find() {
    return this;
  },
  closest() {
    return this;
  },
  eq() {
    return this;
  },
  first() {
    return this;
  },
  last() {
    return this;
  },
  is() {
    return false;
  },
  attr(): null {
    return null;
  },
  prop() {
    return this;
  },
  append() {
    return this;
  },
  remove() {
    return this;
  },
  empty() {
    return this;
  },
  trigger() {
    return this;
  },
  click() {
    return this;
  },
};

function makeColl(elems: Element[]): JqCollection {
  const c: JqCollection = Object.create(coll);
  Object.defineProperty(c, 'length', { value: elems.length });
  for (let i = 0; i < elems.length; i++) c[i] = elems[i];

  c.on = function (event: string, fn: (this: Element, ev: Event) => void) {
    for (const el of elems) el.addEventListener(event, fn as EventListener);
    return c;
  };
  c.text = function (v?: string) {
    if (v === undefined) return elems.length ? elems[0].textContent ?? '' : '';
    for (const el of elems) el.textContent = v;
    return c;
  };
  c.html = function (v?: string) {
    if (v === undefined) return elems.length ? elems[0].innerHTML : '';
    for (const el of elems) el.innerHTML = v;
    return c;
  };
  c.css = function (prop: string | Record<string, string>, val?: string) {
    if (typeof prop === 'object') {
      for (const el of elems) {
        for (const [k, v] of Object.entries(prop)) (el as HTMLElement).style.setProperty(k, v);
      }
      return c;
    }
    if (val === undefined) {
      return elems.length ? (elems[0] as HTMLElement).style.getPropertyValue(prop) : '';
    }
    for (const el of elems) (el as HTMLElement).style.setProperty(prop, val);
    return c;
  };
  c.addClass = function (cls: string) {
    for (const el of elems) el.classList.add(...cls.split(/\s+/).filter(Boolean));
    return c;
  };
  c.removeClass = function (cls: string) {
    for (const el of elems) el.classList.remove(...cls.split(/\s+/).filter(Boolean));
    return c;
  };
  c.hasClass = function (cls: string) {
    return elems.some((el) => el.classList.contains(cls));
  };
  c.data = function (key: string) {
    if (!elems.length) return undefined;
    return elems[0].getAttribute(`data-${key}`) ?? undefined;
  };
  c.val = function (v?: string) {
    if (v === undefined) {
      const el = elems[0] as HTMLInputElement | undefined;
      return el ? el.value : '';
    }
    for (const el of elems) (el as HTMLInputElement).value = v;
    return c;
  };
  c.each = function (fn: (this: Element, i: number, el: Element) => void) {
    elems.forEach((el, i) => fn.call(el, i, el));
    return c;
  };
  c.hide = function () {
    for (const el of elems) (el as HTMLElement).style.display = 'none';
    return c;
  };
  c.show = function () {
    for (const el of elems) (el as HTMLElement).style.display = '';
    return c;
  };
  c.filter = function (sel: string | ((this: Element, i: number, el: Element) => boolean)) {
    if (typeof sel === 'function') return makeColl(elems.filter((el, i) => sel.call(el, i, el)));
    return makeColl(elems.filter((el) => matchesSel(el, sel)));
  };
  c.find = function (sel: string) {
    const out: Element[] = [];
    for (const el of elems) {
      const nodes = el.querySelectorAll(sel);
      out.push(...Array.from(nodes));
    }
    return makeColl(out);
  };
  c.closest = function (sel: string) {
    const out: Element[] = [];
    for (const el of elems) {
      let cur: Element | null = el;
      while (cur) {
        if (matchesSel(cur, sel)) {
          out.push(cur);
          break;
        }
        cur = cur.parentElement;
      }
    }
    return makeColl(out);
  };
  c.eq = function (i: number) {
    const idx = i < 0 ? elems.length + i : i;
    const one = elems[idx];
    return makeColl(one ? [one] : []);
  };
  c.first = function () {
    return makeColl(elems.length ? [elems[0]] : []);
  };
  c.last = function () {
    return makeColl(elems.length ? [elems[elems.length - 1]] : []);
  };
  c.is = function (sel: string) {
    return elems.some((el) => matchesSel(el, sel));
  };
  c.attr = function (name: string, v?: string) {
    if (v === undefined) return elems.length ? elems[0].getAttribute(name) : null;
    for (const el of elems) el.setAttribute(name, v);
    return c;
  };
  c.prop = function (name: string, v?: unknown) {
    // 用 Reflect 读写:作者脚本会往 DOM 元素上挂自定义属性($('x').prop('checked', true)),
    // Element 类型没有索引签名,换成类型断言就成了 ratchet 涨记账,Reflect 是零断言的等价手段。
    if (v === undefined) return elems.length ? Reflect.get(elems[0], name) : undefined;
    for (const el of elems) Reflect.set(el, name, v);
    return c;
  };
  c.append = function (content: string | Element) {
    for (const el of elems) {
      if (typeof content === 'string') el.insertAdjacentHTML('beforeend', content);
      else el.appendChild(content);
    }
    return c;
  };
  c.remove = function () {
    for (const el of elems) el.parentElement?.removeChild(el);
    return c;
  };
  c.empty = function () {
    for (const el of elems) el.textContent = '';
    return c;
  };
  c.trigger = function (ev: string) {
    for (const el of elems) el.dispatchEvent(new Event(String(ev), { bubbles: true }));
    return c;
  };
  c.click = function (fn?: (this: Element, ev: Event) => void) {
    if (typeof fn === 'function') return c.on('click', fn);
    for (const el of elems) (el as HTMLElement).click?.();
    return c;
  };
  return c;
}

/** 选择器判定:镜像元素门面可能没有 matches,退化到 id/class/标签粗匹配 */
function matchesSel(el: Element, selector: string): boolean {
  const s = selector.trim();
  if (!s) return false;
  const matches = (el as Element & { matches?: (q: string) => boolean }).matches;
  if (typeof matches === 'function') {
    try {
      return matches.call(el, s);
    } catch {
      return false;
    }
  }
  const idMatch = /^#([\w-]+)$/.exec(s);
  if (idMatch) return el.id === idMatch[1];
  const clsMatch = /^\.([\w-]+)$/.exec(s);
  if (clsMatch) return el.classList.contains(clsMatch[1]);
  return el.tagName.toLowerCase() === s.toLowerCase();
}

// root 允许 Document:未 setJQueryRoot 时回退 document(既有运行时行为),
// Document 与 Element 均实现 ParentNode.querySelectorAll,仅首个作用域可能是 Document。
function queryOne(sel: string, root: Element | Document): Element[] {
  let s = sel.trim();
  if (!s) return [];
  const pseudo: string[] = [];
  s = s.replace(/(:[a-z-]+)/g, (_m, p) => {
    pseudo.push(p);
    return '';
  });
  // 后代选择器
  const parts = s.split(/\s+/).filter(Boolean);
  let scope: Array<Element | Document> = [root];
  for (const part of parts) {
    const next: Element[] = [];
    for (const sc of scope) {
      const found = matchIn(part, sc);
      next.push(...found);
    }
    scope = next;
  }
  // scope 经 parts 迭代后只剩 Element;唯一例外是纯伪类选择器(无 parts)时仍含初始 root
  // (可能是 document 回退),保持既有运行时语义,按 Element[] 断言返回。
  let result: Element[] = scope as Element[];
  for (const p of pseudo) {
    if (p === ':first' && result.length > 0) result = [result[0]];
    else if (p === ':last' && result.length > 0) result = [result[result.length - 1]];
  }
  return result;
}

// scope 允许 Document(见 queryOne 注释);仅用 querySelectorAll,行为不变
function matchIn(part: string, scope: Element | Document): Element[] {
  const tag = /^[a-zA-Z][\w-]*/.exec(part)?.[0] ?? '';
  const idM = /#([\w-]+)/.exec(part);
  const clsM = /\.([\w-]+)/g;
  const classes: string[] = [];
  let cm: RegExpExecArray | null;
  while ((cm = clsM.exec(part)) !== null) classes.push(cm[1]);

  const descend = scope.querySelectorAll(tag || '*');
  const out: Element[] = [];
  for (const el of Array.from(descend)) {
    if (idM && el.id !== idM[1]) continue;
    if (classes.length > 0 && !classes.every((c) => el.classList.contains(c))) continue;
    out.push(el);
  }
  return out;
}

/**
 * 全局 `$`:selector → 集合;Element/Element[] → 集合(供 `$(this)` 使用);
 * function → ready 回调。
 * 查询仅作用于 setJQueryRoot 设定的容器;未设置时回退 document。
 */
export function miniJQuery(arg: string | Element | Element[] | ((this: Window) => void)): JqCollection | void {
  if (typeof arg === 'function') {
    onJqReady(arg);
    return undefined;
  }
  if (arg instanceof Element) {
    return makeColl([arg]);
  }
  if (Array.isArray(arg)) {
    return makeColl(arg.filter((e): e is Element => e instanceof Element));
  }
  const root = currentRoot ?? document;
  return makeColl(queryOne(String(arg), root));
}
