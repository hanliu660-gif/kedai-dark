// 夜间模式令牌级对比度契约(NIGHT-1,2026-10-26)。
//
// 与 styles/contrast.test.ts(亮色,UIP-10)同一套算法、同一套取值方式,只是作用域换成
// tokens.css 里的 `:root[data-theme='dark']` 块:小字仍按 WCAG 2.x 相对亮度公式实测,
// 强制对全部 ≥ 4.5:1。把「暗色也读得清」从注释承诺变成机器事实 —— 改暗色值必须跑它。
//
// 另外三条反漂移断言:
// - 暗色块不许发明亮色里没有的令牌名(否则亮色下没有基线,覆写等于没定义);
// - chip/mark 五个配对令牌在亮色下必须逐字指回原语义色(保证暗色改造对亮色零视觉变化);
// - --sv-on-ink-soft(黑底次级文字)在暗色下必须跟着对调,否则黑底上的文字会消失。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const tokensCss = readFileSync(new URL('tokens.css', import.meta.url), 'utf8');

/** 取某个选择器的块体(按花括号配对;本文件只需要处理单层嵌套)。 */
function blockBody(css: string, selector: string): string {
  const at = css.indexOf(selector);
  if (at < 0) throw new Error(`tokens.css 缺少选择器 ${selector}`);
  const open = css.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    const ch = css[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error(`选择器 ${selector} 的块没有闭合`);
}

const lightBody = blockBody(tokensCss, ':root {');
const darkBody = blockBody(tokensCss, ":root[data-theme='dark']");

/** 块内取声明值(返回值里的注释已剥掉)。 */
function decl(scope: string, name: string): string | null {
  const m = scope.match(new RegExp(`^[ \t]*${name}[ \t]*:[ \t]*([^;]+);`, 'm'));
  return m ? m[1].trim() : null;
}

/** 暗色值;暗色块没覆写才回落到亮色(理论上不该发生,见反漂移断言)。 */
function darkToken(name: string): string {
  const v = decl(darkBody, name) ?? decl(lightBody, name);
  if (!v) throw new Error(`tokens.css 缺少 ${name}`);
  return v;
}

/** 亮色值,并把 `var(--sv-x)` 形态解开一层(亮色下 chip 令牌是别名)。 */
function lightToken(name: string): string {
  const v = decl(lightBody, name);
  if (!v) throw new Error(`tokens.css 缺少 ${name}`);
  const alias = v.match(/^var\((--[a-z0-9-]+)\)$/);
  return alias ? lightToken(alias[1]) : v;
}

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const toRgba = (raw: string): Rgba => {
  const hex = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1];
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: 1,
    };
  }
  const fn = raw.match(/^rgba?\(([^)]+)\)$/i);
  if (fn) {
    const p = fn[1].split(',').map((s) => Number(s.trim()));
    return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 };
  }
  throw new Error(`无法解析颜色:${raw}`);
};

const over = (fg: Rgba, bg: Rgba): Rgba => ({
  r: fg.a * fg.r + (1 - fg.a) * bg.r,
  g: fg.a * fg.g + (1 - fg.a) * bg.g,
  b: fg.a * fg.b + (1 - fg.a) * bg.b,
  a: 1,
});

const linear = (c: number): number => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};

const luminance = (c: Rgba): number => 0.2126 * linear(c.r) + 0.7152 * linear(c.g) + 0.0722 * linear(c.b);

const contrast = (fgRaw: string, bgRaw: string): number => {
  const bg = toRgba(bgRaw);
  const fg0 = toRgba(fgRaw);
  const fg = fg0.a < 1 ? over(fg0, bg) : fg0;
  const l1 = Math.max(luminance(fg), luminance(bg));
  const l2 = Math.min(luminance(fg), luminance(bg));
  return (l1 + 0.05) / (l2 + 0.05);
};

/** 暗色强制对:小字(≤12px)字色 × 底色。与亮色那 15 对同构,多出 chip/mark 五对。 */
const PAIRS: Array<[string, string]> = [
  ['--sv-ink-faint', '--sv-paper'], // 侧栏/画布上的说明文字
  ['--sv-ink-faint', '--sv-surface'], // 设置字段、顶栏副标、输入栏提示
  ['--sv-ink-faint', '--sv-pink-light'], // hover 底(角色行说明等)
  ['--sv-ink-faint', '--sv-white'], // 卡片内数据行
  ['--sv-ink-dim', '--sv-surface'],
  ['--sv-ink', '--sv-paper'],
  ['--sv-ink', '--sv-surface'],
  ['--sv-ink', '--sv-white'],
  ['--sv-ink', '--sv-pink-light'],
  ['--sv-white', '--sv-ink'], // 主按钮(一身二职对调后是浅底深字)
  ['--sv-white', '--sv-ink-supreme'],
  ['--sv-white', '--sv-chip-blue'], // MemoryPanel kind=distilled
  ['--sv-white', '--sv-chip-gray'], // MemoryPanel kind=unknown
  ['--sv-pink-dark', '--sv-white'], // MemoryPanel 置顶标记
  ['--sv-ink', '--sv-chip-yellow'], // MemoryPanel kind=tool
  ['--sv-ink', '--sv-chip-green'], // MemoryPanel kind=manual
  ['--sv-ink', '--sv-mark-bg'], // 记忆搜索命中高亮
];

describe('NIGHT-1 暗色令牌级小字对比度契约(WCAG AA ≥ 4.5:1)', () => {
  for (const [fgName, bgName] of PAIRS) {
    it(`${fgName} on ${bgName}`, () => {
      const ratio = contrast(darkToken(fgName), darkToken(bgName));
      expect(
        ratio,
        `${fgName}(${darkToken(fgName)}) on ${bgName}(${darkToken(bgName)}) = ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe('NIGHT-1 反漂移', () => {
  it('暗色块不新造令牌名(每个都必须能在亮色 :root 里找到)', () => {
    const names = new Set(
      Array.from(darkBody.matchAll(/^[ \t]*(--[a-z0-9-]+)[ \t]*:/gm)).map((m) => m[1]),
    );
    expect(names.size).toBeGreaterThan(30);
    const lightNames = new Set(
      Array.from(lightBody.matchAll(/^[ \t]*(--[a-z0-9-]+)[ \t]*:/gm)).map((m) => m[1]),
    );
    const invented = [...names].filter((n) => !lightNames.has(n));
    expect(invented, `暗色块里有亮色不存在的令牌:${invented.join(', ')}`).toEqual([]);
  });

  it('五个配对令牌在亮色下逐字指回原语义色(暗色改造对亮色零视觉变化)', () => {
    expect(decl(lightBody, '--sv-chip-blue')).toBe('var(--sv-blue)');
    expect(decl(lightBody, '--sv-chip-gray')).toBe('var(--sv-ink-faint)');
    expect(decl(lightBody, '--sv-chip-yellow')).toBe('var(--sv-yellow)');
    expect(decl(lightBody, '--sv-chip-green')).toBe('var(--sv-green)');
    expect(decl(lightBody, '--sv-mark-bg')).toBe('var(--sv-yellow)');
  });

  it('亮色下 chip 令牌与语义色取到的实际值相同', () => {
    expect(lightToken('--sv-chip-blue')).toBe(lightToken('--sv-blue'));
    expect(lightToken('--sv-chip-gray')).toBe(lightToken('--sv-ink-faint'));
    expect(lightToken('--sv-chip-yellow')).toBe(lightToken('--sv-yellow'));
    expect(lightToken('--sv-chip-green')).toBe(lightToken('--sv-green'));
    expect(lightToken('--sv-mark-bg')).toBe(lightToken('--sv-yellow'));
  });

  it('一身二职令牌成对对调(ink/white 与 on-ink-soft)', () => {
    // 对调:亮色 ink 深、white 浅;暗色反过来。
    expect(luminance(toRgba(lightToken('--sv-ink')))).toBeLessThan(luminance(toRgba(lightToken('--sv-white'))));
    expect(luminance(toRgba(darkToken('--sv-ink')))).toBeGreaterThan(luminance(toRgba(darkToken('--sv-white'))));
    // 深底上的次级文字:亮色是白系半透明,暗色必须是深系半透明。
    expect(contrast(darkToken('--sv-on-ink-soft'), darkToken('--sv-ink'))).toBeGreaterThanOrEqual(4.5);
  });

  it('暗色下 color-scheme 声明为 dark(原生控件/滚动条跟随)', () => {
    expect(decl(darkBody, 'color-scheme')).toBe('dark');
  });
});
