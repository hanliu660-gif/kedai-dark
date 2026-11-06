// 配色方案契约(2026-11-03;2026-11-07 改为「数据是唯一真相源 + CSS 生成物同步断言」)。
//
// 两层断言:
// 1. 数据层(web/src/theme/palettes.ts):每套配色必须给足 17 个令牌(明/暗档按 darkOnly 规则),
//    对比度达标(正文 ≥ 7:1、次要文字 ≥ 4.5:1、重块 ≥ 4.5:1),纯黑配色不得出现亮块/纯白;
// 2. 生成物层(web/src/styles/palettes.css):由 tools/generate-tokens.mjs 从数据生成,
//    这里逐键逐值比对,确保 CSS 没被手改(门禁 web: tokens-sync 的 --check 是同一约束的粗粒度版)。
//
// 对比度算法与 styles/contrast.test.ts / darkContrast.test.ts 同一套(WCAG 2.x 相对亮度)。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_PALETTE_ID,
  PALETTES,
  PALETTE_EXTRA_TOKEN_KEYS,
  PALETTE_TOKEN_KEYS,
  type PaletteDefinition,
} from './palettes';
import { DARK_THEME } from './builtin';
import { DARK_THEME_TOKENS } from './darkTokens';

const css = readFileSync(new URL('../styles/palettes.css', import.meta.url), 'utf8');
const bootJs = readFileSync(new URL('../../public/theme-boot.js', import.meta.url), 'utf8');

type Mode = 'light' | 'dark';
type TokenRecord = Record<string, string>;

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

const lightSelector = (id: string): string => `:root[data-palette='${id}']:not([data-theme='dark'])`;
const darkSelector = (id: string): string => `:root[data-theme='dark'][data-palette='${id}']`;

/** 该配色要覆盖的明暗档:darkOnly 只有深色。 */
function modesOf(palette: PaletteDefinition): Mode[] {
  return palette.darkOnly ? ['dark'] : ['light', 'dark'];
}

/** 从数据里取某档令牌;数据缺档直接抛错(测试消息里能一眼看出哪套哪档)。 */
function tokensOf(palette: PaletteDefinition, mode: Mode): TokenRecord {
  const tokens = palette.tokens;
  if (!tokens) throw new Error(`配色 ${palette.id} 没有 tokens(只有 default 允许省略)`);
  const record = mode === 'light' ? tokens.light : tokens.dark;
  if (!record) throw new Error(`配色 ${palette.id} 缺 ${mode} 档令牌`);
  return record as TokenRecord;
}

describe('配色数据(palettes.ts = 唯一真相源)', () => {
  it('默认配色走基底,其余每套必须自带 tokens', () => {
    for (const p of PALETTES) {
      if (p.id === DEFAULT_PALETTE_ID) {
        expect(p.tokens, 'default 应走 tokens.css 构成主义基底,不应自带令牌').toBeUndefined();
      } else {
        expect(p.tokens, `配色 ${p.id} 缺少 tokens`).toBeDefined();
      }
    }
  });

  it('每套配色的明暗档都覆盖全部 17 个令牌(darkOnly 只给深色)', () => {
    for (const p of nonDefault) {
      for (const mode of modesOf(p)) {
        const record = tokensOf(p, mode);
        for (const key of PALETTE_TOKEN_KEYS) {
          expect(record[key], `${p.id}/${mode} 缺 ${key}`).toBeTruthy();
        }
      }
      if (p.darkOnly) expect(p.tokens?.light, `${p.id} 不该有浅色档`).toBeUndefined();
      else expect(p.tokens?.light, `${p.id} 缺浅色档`).toBeDefined();
    }
  });

  it('额外压暗令牌只给深色档、键都在白名单内,且目前只有纯黑用', () => {
    for (const p of nonDefault) {
      const extras = p.tokens?.darkExtras;
      if (!extras) continue;
      for (const [key, value] of Object.entries(extras)) {
        expect(PALETTE_EXTRA_TOKEN_KEYS, `${p.id} 的额外令牌 ${key} 不在白名单`).toContain(key);
        expect(value, `${p.id} 的额外令牌 ${key} 没有值`).toBeTruthy();
      }
    }
    expect(
      nonDefault.filter((p) => p.tokens?.darkExtras).map((p) => p.id),
      '额外压暗令牌目前只为纯黑 OLED 设计',
    ).toEqual(['oled']);
  });

  it('对比度达标:正文 ≥ 7:1、次要文字 ≥ 4.5:1、重块 ≥ 4.5:1', () => {
    for (const p of nonDefault) {
      for (const mode of modesOf(p)) {
        const t = tokensOf(p, mode);
        expect(ratio(t['--sv-ink'], t['--sv-paper']), `${p.id}/${mode} 正文对画布`).toBeGreaterThanOrEqual(7);
        expect(ratio(t['--sv-ink'], t['--sv-surface']), `${p.id}/${mode} 正文对面板`).toBeGreaterThanOrEqual(7);
        expect(ratio(t['--sv-ink-dim'], t['--sv-paper']), `${p.id}/${mode} 次要文字`).toBeGreaterThanOrEqual(4.5);
        expect(ratio(t['--sv-ink-faint'], t['--sv-paper']), `${p.id}/${mode} 辅助文字`).toBeGreaterThanOrEqual(4.5);
        expect(ratio(t['--sv-block-fg'], t['--sv-block-bg']), `${p.id}/${mode} 重块文字`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('纯黑:画布 #000,且任何"面/块"令牌都不亮(不允许出现刺眼块)', () => {
    const oled = PALETTES.find((p) => p.id === 'oled');
    expect(oled, '缺少纯黑配色').toBeDefined();
    const dark = tokensOf(oled as PaletteDefinition, 'dark');
    const extras = (oled as PaletteDefinition).tokens?.darkExtras ?? {};
    expect(dark['--sv-paper']).toBe('#000000');

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
    const extraValues: TokenRecord = extras;
    for (const token of FILL_TOKENS) {
      const value = dark[token] ?? extraValues[token];
      expect(value, `纯黑缺 ${token}`).toBeTruthy();
      const lum = luminance(value as string);
      expect(lum, `${token}=${value} 在纯黑上过亮(相对亮度 ${lum.toFixed(2)} > 0.55)`).toBeLessThanOrEqual(0.55);
    }

    // 纯白是纯黑模式的头号刺眼源:任何令牌都不许等于 #ffffff
    for (const [token, value] of [...Object.entries(dark), ...Object.entries(extras)]) {
      expect(value.toLowerCase(), `纯黑配色的 ${token} 是纯白`).not.toBe('#ffffff');
    }
  });
});

describe('生成物 palettes.css(不得手改)', () => {
  it('每套配色都有对应明暗段(darkOnly 只要求深色段,且不得偷写浅色段)', () => {
    for (const p of nonDefault) {
      const dark = blockBody(css, darkSelector(p.id));
      for (const token of PALETTE_TOKEN_KEYS) {
        expect(decl(dark, token), `${p.id} 深色缺 ${token}`).not.toBeNull();
      }
      if (p.darkOnly) {
        // 只做深色的配色在浅色下无定义:若真写了浅色段,说明有人误解了它的定位
        expect(css.includes(lightSelector(p.id)), `${p.id} 不该有浅色段`).toBe(false);
        continue;
      }
      const light = blockBody(css, lightSelector(p.id));
      for (const token of PALETTE_TOKEN_KEYS) {
        expect(decl(light, token), `${p.id} 浅色缺 ${token}`).not.toBeNull();
      }
    }
  });

  it('CSS 逐键逐值与 palettes.ts 一致(生成物被手改就会在这里红)', () => {
    for (const p of nonDefault) {
      for (const mode of modesOf(p)) {
        const body = blockBody(css, mode === 'light' ? lightSelector(p.id) : darkSelector(p.id));
        const record = tokensOf(p, mode);
        for (const key of PALETTE_TOKEN_KEYS) {
          expect(decl(body, key), `${p.id}/${mode} ${key} 与 palettes.ts 不一致`).toBe(record[key]);
        }
        if (mode === 'dark' && p.tokens?.darkExtras) {
          for (const [key, value] of Object.entries(p.tokens.darkExtras)) {
            expect(decl(body, key), `${p.id} 额外令牌 ${key} 与 palettes.ts 不一致`).toBe(value);
          }
        }
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
