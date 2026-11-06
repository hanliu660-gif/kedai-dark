// 配色方案契约(2026-11-03)。
//
// 三组断言:
// 1. CSS/TS 双向一致:palettes.ts 里登记了哪几套,palettes.css 就必须有对应的 light+dark 两段;
//    CSS 里出现的 data-palette 值也必须都已登记(防手写孤儿配色);
// 2. 令牌完整:每段必须覆盖同一组 17 个令牌——少一个就会在某个明暗档里露出基底粉色,
//    这正是"配色只改一半"最常见的翻车方式;
// 3. 对比度:正文 ≥ 7:1、次要文字 ≥ 4.5:1、重块文字 ≥ 4.5:1(WCAG 2.x 相对亮度公式,
//    与 styles/contrast.test.ts / darkContrast.test.ts 同一套算法)。护眼不等于低对比到读不清。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DEFAULT_PALETTE_ID, PALETTES } from './palettes';
import { DARK_THEME } from './builtin';
import { DARK_THEME_TOKENS } from './darkTokens';

const css = readFileSync(new URL('../styles/palettes.css', import.meta.url), 'utf8');
const bootJs = readFileSync(new URL('../../public/theme-boot.js', import.meta.url), 'utf8');

/** 取选择器块体(花括号配对,本文件只有单层嵌套)。 */
function blockBody(source: string, selector: string): string {
  const at = source.indexOf(selector);
  if (at < 0) throw new Error(`palettes.css 缺少选择器 ${selector}`);
  const open = source.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error(`选择器 ${selector} 的块没有闭合`);
}

function decl(scope: string, name: string): string | null {
  const m = scope.match(new RegExp(`^[ \\t]*${name}[ \\t]*:[ \\t]*([^;]+);`, 'm'));
  return m ? m[1].trim() : null;
}

/** 每套配色必须覆盖的令牌(与 tokens.css 基线同名的 17 个)。 */
const REQUIRED_TOKENS = [
  '--sv-paper',
  '--sv-surface',
  '--sv-surface-elevated',
  '--sv-white',
  '--sv-ink',
  '--sv-ink-soft',
  '--sv-ink-dim',
  '--sv-ink-faint',
  '--sv-line',
  '--sv-line-strong',
  '--sv-pink',
  '--sv-pink-light',
  '--sv-pink-medium',
  '--sv-pink-deep',
  '--sv-pink-dark',
  '--sv-block-bg',
  '--sv-block-fg',
] as const;

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(fg: string, bg: string): number {
  const a = luminance(fg);
  const b = luminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

const nonDefault = PALETTES.filter((p) => p.id !== DEFAULT_PALETTE_ID);

describe('配色方案契约', () => {
  it('每套配色都有对应明暗段（darkOnly 只要求深色段，且不得偷写浅色段）', () => {
    for (const p of nonDefault) {
      const dark = blockBody(css, `:root[data-theme='dark'][data-palette='${p.id}']`);
      for (const token of REQUIRED_TOKENS) {
        expect(decl(dark, token), `${p.id} 深色缺 ${token}`).not.toBeNull();
      }
      if (p.darkOnly) {
        // 只做深色的配色在浅色下无定义:若真写了浅色段,说明有人误解了它的定位
        expect(css.includes(`:root[data-palette='${p.id}']:not([data-theme='dark'])`)).toBe(false);
        continue;
      }
      const light = blockBody(css, `:root[data-palette='${p.id}']:not([data-theme='dark'])`);
      for (const token of REQUIRED_TOKENS) {
        expect(decl(light, token), `${p.id} 浅色缺 ${token}`).not.toBeNull();
      }
    }
  });

  it('palettes.css 里没有未登记的 data-palette 值', () => {
    const ids = new Set(PALETTES.map((p) => p.id));
    for (const m of css.matchAll(/data-palette='([a-z0-9-]+)'/g)) {
      expect(ids.has(m[1]), `palettes.css 出现了未登记的配色 ${m[1]}`).toBe(true);
    }
  });

  it('theme-boot.js 的白名单与 PALETTES 完全一致(首帧不闪错配色)', () => {
    const m = bootJs.match(/PALETTE_IDS\s*=\s*\[([^\]]*)\]/);
    expect(m, 'theme-boot.js 缺少 PALETTE_IDS').not.toBeNull();
    const ids = (m as RegExpMatchArray)[1]
      .split(',')
      .map((s) => s.trim().replace(/^'|'$/g, ''))
      .filter(Boolean);
    expect(ids.sort()).toEqual(nonDefault.map((p) => p.id).sort());
  });

  it('对比度达标:正文 ≥ 7:1、次要文字 ≥ 4.5:1、重块 ≥ 4.5:1', () => {
    for (const p of nonDefault) {
      const scopes: Array<[string, string]> = [
        ['dark', `:root[data-theme='dark'][data-palette='${p.id}']`],
      ];
      if (!p.darkOnly) {
        scopes.unshift(['light', `:root[data-palette='${p.id}']:not([data-theme='dark'])`]);
      }
      for (const [mode, selector] of scopes) {
        const body = blockBody(css, selector);
        const get = (n: string): string => decl(body, n) as string;
        const paper = get('--sv-paper');
        const surface = get('--sv-surface');
        expect(ratio(get('--sv-ink'), paper), `${p.id}/${mode} 正文对画布`).toBeGreaterThanOrEqual(7);
        expect(ratio(get('--sv-ink'), surface), `${p.id}/${mode} 正文对面板`).toBeGreaterThanOrEqual(7);
        expect(ratio(get('--sv-ink-dim'), paper), `${p.id}/${mode} 次要文字`).toBeGreaterThanOrEqual(4.5);
        expect(ratio(get('--sv-ink-faint'), paper), `${p.id}/${mode} 辅助文字`).toBeGreaterThanOrEqual(4.5);
        expect(ratio(get('--sv-block-fg'), get('--sv-block-bg')), `${p.id}/${mode} 重块文字`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('纯黑:画布 #000,且任何"面/块"令牌都不亮(不允许出现刺眼块)', () => {
    const body = blockBody(css, ":root[data-theme='dark'][data-palette='oled']");
    expect(decl(body, '--sv-paper')).toBe('#000000');

    /** 这些令牌决定"面/块/线"的亮度;一旦偏亮就是纯黑画布上刺眼的那一块。
     *  正文色(--sv-ink/--sv-block-fg)与按钮文字不在此列:它们是字形,不是面。 */
    const FILL_TOKENS = [
      '--sv-paper',
      '--sv-surface',
      '--sv-surface-elevated',
      '--sv-white',
      '--sv-block-bg',
      '--sv-line',
      '--sv-line-strong',
      '--sv-pink',
      '--sv-pink-light',
      '--sv-pink-medium',
      '--sv-ink-supreme',
      '--sv-red',
      '--sv-yellow',
      '--sv-green',
      '--sv-orange',
      '--sv-purple',
    ];
    for (const token of FILL_TOKENS) {
      const value = decl(body, token);
      expect(value, `纯黑缺 ${token}`).not.toBeNull();
      const lum = luminance(value as string);
      expect(lum, `${token}=${value} 在纯黑上过亮(相对亮度 ${lum.toFixed(2)} > 0.55)`).toBeLessThanOrEqual(0.55);
    }

    // 纯白是纯黑模式的头号刺眼源:任何令牌都不许等于 #ffffff
    for (const m of body.matchAll(/--[a-z0-9-]+:\s*(#[0-9a-fA-F]{6})/g)) {
      expect(m[1].toLowerCase(), `纯黑配色里出现了纯白 ${m[0]}`).not.toBe('#ffffff');
    }
  });
});

/* 2026-11-03 现场 bug:深色下点任何配色都"没反应"。
   根因不是 CSS,而是 registry.apply 把暗色令牌写成了 <html style="--sv-paper:...">,
   内联样式优先级高于任何选择器,于是 palettes.css 的 dark 段永远被顶掉。
   这里把「暗色主题不得内联令牌」钉成契约,防止有人又把它加回 DARK_THEME.tokens。 */
describe('暗色主题不得内联令牌', () => {
  it('DARK_THEME.tokens 必须为空(令牌只由 tokens.css 的 :root[data-theme=dark] 提供)', () => {
    expect(DARK_THEME.tokens, '暗色令牌一旦写进 DARK_THEME.tokens,就会以内联样式压掉所有 data-palette 规则').toBeUndefined();
  });

  it('tokens.css 仍完整提供暗色令牌(darkTokens.ts 双向同源)', () => {
    const tokensCss = readFileSync(new URL('../styles/tokens.css', import.meta.url), 'utf8');
    const body = blockBody(tokensCss, ":root[data-theme='dark']");
    for (const key of Object.keys(DARK_THEME_TOKENS)) {
      expect(decl(body, key), `tokens.css 暗色段缺 ${key}`).toBe(DARK_THEME_TOKENS[key]);
    }
  });
});
