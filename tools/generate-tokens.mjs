#!/usr/bin/env node
/**
 * generate-tokens.mjs —— 生成物同步器:单一真相源(TS) → 生成物(CSS)
 *
 * 管两份生成物:
 * 1. web/src/theme/darkTokens.ts → web/src/styles/tokens.css 的 :root[data-theme='dark'] 块;
 * 2. web/src/theme/palettes.ts   → web/src/styles/palettes.css(整文件,含头部设计约束)。
 *
 * 运行:
 *   node tools/generate-tokens.mjs         # 同步写出两份 CSS
 *   node tools/generate-tokens.mjs --check # 校验两份 CSS 是否已同步(门禁 web: tokens-sync 用)
 *
 * 手改 tokens.css 的暗色块、或手改 palettes.css 的任何一行,都会被本脚本覆盖或被 --check 判红。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const isCheck = process.argv.includes('--check');
let hasDrift = false;

// ================================================================ 1) 暗色令牌
// 从 darkTokens.ts 中提取键值对
const TOKENS_TS = join(ROOT, 'web', 'src', 'theme', 'darkTokens.ts');
const TOKENS_CSS = join(ROOT, 'web', 'src', 'styles', 'tokens.css');

const tsContent = readFileSync(TOKENS_TS, 'utf8');
const tokenMatches = [...tsContent.matchAll(/'(--[a-z0-9-]+)':\s*'([^']+)'/g)];
if (tokenMatches.length === 0) {
  console.error('[FAIL] 未能从 darkTokens.ts 解析出令牌');
  process.exit(1);
}

const START_MARKER = '/* @generated:dark-tokens:start - 单一真相源: web/src/theme/darkTokens.ts */';
const END_MARKER = '/* @generated:dark-tokens:end */';

const generatedLines = [
  START_MARKER,
  ":root[data-theme='dark'] {",
  '  color-scheme: dark;',
  ...tokenMatches.map(([_, name, val]) => `  ${name}: ${val};`),
  '}',
  END_MARKER,
];
const generatedBlock = generatedLines.join('\n');

const cssContent = readFileSync(TOKENS_CSS, 'utf8');

// 匹配既有的生成块,或既有的 :root[data-theme='dark'] { ... } 块
let newCss;
if (cssContent.includes(START_MARKER) && cssContent.includes(END_MARKER)) {
  const startIdx = cssContent.indexOf(START_MARKER);
  const endIdx = cssContent.indexOf(END_MARKER) + END_MARKER.length;
  newCss = cssContent.slice(0, startIdx) + generatedBlock + cssContent.slice(endIdx);
} else {
  const darkSelector = ":root[data-theme='dark']";
  const startIdx = cssContent.indexOf(darkSelector);
  if (startIdx === -1) {
    console.error(`[FAIL] ${TOKENS_CSS} 缺少选择器 ${darkSelector}`);
    process.exit(1);
  }
  const endIdx = cssContent.lastIndexOf('}');
  if (endIdx === -1 || endIdx < startIdx) {
    console.error(`[FAIL] 无法找到 ${darkSelector} 的结束括号`);
    process.exit(1);
  }
  newCss = cssContent.slice(0, startIdx) + generatedBlock + cssContent.slice(endIdx + 1);
}

if (cssContent !== newCss) {
  if (isCheck) {
    console.error(
      '[FAIL] tokens.css 中的暗色令牌与 darkTokens.ts 不同步!请运行 node tools/generate-tokens.mjs 更新。',
    );
    hasDrift = true;
  } else {
    writeFileSync(TOKENS_CSS, newCss, 'utf8');
    console.log(`[OK] 已从 darkTokens.ts 同步 ${tokenMatches.length} 个令牌至 tokens.css`);
  }
} else if (isCheck) {
  console.log(`[OK] tokens.css 与 darkTokens.ts 保持 100% 逐键逐值一致(共 ${tokenMatches.length} 个令牌)`);
}

// ============================================================ 2) 配色令牌
// palettes.ts 是配色令牌的唯一真相源;palettes.css 整个文件都由这里生成。
const PALETTES_TS = join(ROOT, 'web', 'src', 'theme', 'palettes.ts');
const PALETTES_CSS = join(ROOT, 'web', 'src', 'styles', 'palettes.css');
const PALETTES_START = '/* @generated:palettes:start - 单一真相源: web/src/theme/palettes.ts */';
const PALETTES_END = '/* @generated:palettes:end */';

// Node 24 可直接 import .ts(type stripping)。压掉仅此一次的 ExperimentalWarning,
// 否则门禁日志里会多一行噪音(stderr 在 pwsh 下还会被包成 NativeCommandError 显示)。
const savedEmitWarning = process.emitWarning;
process.emitWarning = () => {};
const { PALETTES, PALETTE_TOKEN_KEYS, PALETTE_EXTRA_TOKEN_KEYS } = await import(
  pathToFileURL(PALETTES_TS).href
);
process.emitWarning = savedEmitWarning;

const PALETTES_HEADER = [
  '/* ============================================================================',
  '   palettes.css —— 柔和护眼配色(2026-11-03 立,2026-11-07 改为生成物)',
  '   ----------------------------------------------------------------------------',
  '   ⚠️ 本文件由 node tools/generate-tokens.mjs 从 web/src/theme/palettes.ts 生成,',
  '   连这段头注释也是脚本里的常量 —— 要改配色值或新增配色改 palettes.ts,',
  '   要改这段说明改生成脚本;手改本文件会被下一次生成覆盖,且门禁 --check 判红。',
  '',
  '   与明暗模式**正交**:data-theme 决定明/暗,data-palette 决定色相冷暖。',
  '   因此每套配色必须同时给 light 与 dark 两组值(缺一组即由 palettes.test.ts 判红)。',
  '',
  '   设计约束(与 tokens.css 的构成主义基底共存):',
  '   - 只改颜色,不改几何(直角/硬阴影/描边宽度全部沿用 tokens.css);',
  '   - 避纯白纯黑:卡片底最低 #fbfaf7 / #2a252d,--sv-ink 用暖炭黑而非 #141414,',
  '     长时间阅读不刺眼;正文对比仍 ≥ 7:1(--sv-ink)、次要文字 ≥ 4.5:1(--sv-ink-faint);',
  '   - 功能色(红/蓝/黄/绿)不随配色变:危险/停止的语义必须稳定;',
  '   - 重块(--sv-block-bg/fg)同档降饱和,避免配色柔和但按钮仍是死黑。',
  '',
  "   选择器写法:light 用 :not([data-theme='dark']) 兜住\"暗色下不得命中浅色值\",",
  '   否则同特异度的浅色块会按文件顺序覆盖 tokens.css 的暗色基底。',
  '   ============================================================================ */',
].join('\n');

/** 把 palettes.ts 里的 note 渲染成块上方的注释(支持多行设计说明)。 */
function renderNote(note) {
  const lines = String(note).split('\n');
  if (lines.length === 1) return `/* ---------- ${lines[0]} ---------- */`;
  const head = `/* ---------- ${lines[0]} ----------`;
  const body = lines.slice(1, -1).map((line) => `   ${line}`);
  return [head, ...body, `   ${lines[lines.length - 1]} */`].join('\n');
}

/** 一套配色的 CSS:light 段(若有)→ dark 段(darkExtras 并入)。 */
function renderPaletteBlocks(palette) {
  const tokens = palette.tokens;
  if (!tokens) {
    throw new Error(`配色 ${palette.id} 没有 tokens;默认配色(纸面)才会省略 tokens`);
  }
  for (const mode of ['light', 'dark']) {
    const set = tokens[mode];
    if (!set) {
      if (mode === 'light' && palette.darkOnly) continue;
      throw new Error(`配色 ${palette.id} 缺少 ${mode} 令牌集`);
    }
    for (const key of PALETTE_TOKEN_KEYS) {
      if (!set[key]) throw new Error(`配色 ${palette.id} 的 ${mode} 档缺少令牌 ${key}`);
    }
  }
  const decls = (record, keys) =>
    keys.map((key) => `  ${key}: ${record[key]};`).join('\n');

  const blocks = [];
  if (tokens.light) {
    blocks.push(
      [
        `:root[data-palette='${palette.id}']:not([data-theme='dark']) {`,
        decls(tokens.light, PALETTE_TOKEN_KEYS),
        '}',
      ].join('\n'),
    );
  }
  const darkLines = [
    `:root[data-theme='dark'][data-palette='${palette.id}'] {`,
    decls(tokens.dark, PALETTE_TOKEN_KEYS),
    ...(tokens.darkExtras
      ? [decls(tokens.darkExtras, PALETTE_EXTRA_TOKEN_KEYS.filter((key) => tokens.darkExtras[key]))]
      : []),
    '}',
  ];
  blocks.push(darkLines.join('\n'));
  return blocks;
}

const paletteBlocks = [];
let paletteCount = 0;
for (const palette of PALETTES) {
  if (!palette.tokens) continue; // default 走 tokens.css 基底,不生成 data-palette 块
  paletteBlocks.push([renderNote(palette.note), ...renderPaletteBlocks(palette)].join('\n'));
  paletteCount += 1;
}
if (paletteCount === 0) {
  console.error('[FAIL] palettes.ts 里没有任何带 tokens 的配色');
  process.exit(1);
}

const newPalettesCss = [
  PALETTES_HEADER,
  '',
  PALETTES_START,
  '',
  paletteBlocks.join('\n\n'),
  '',
  PALETTES_END,
  '',
].join('\n');

const palettesCssContent = readFileSync(PALETTES_CSS, 'utf8');
if (palettesCssContent !== newPalettesCss) {
  if (isCheck) {
    console.error(
      '[FAIL] palettes.css 与 palettes.ts 不同步!请运行 node tools/generate-tokens.mjs 更新。',
    );
    hasDrift = true;
  } else {
    writeFileSync(PALETTES_CSS, newPalettesCss, 'utf8');
    console.log(
      `[OK] 已从 palettes.ts 生成 palettes.css(${paletteCount} 套配色,各 ${
        PALETTE_TOKEN_KEYS.length
      } 个令牌;额外压暗令牌 ${PALETTE_EXTRA_TOKEN_KEYS.length} 个)`,
    );
  }
} else if (isCheck) {
  console.log(
    `[OK] palettes.css 与 palettes.ts 保持 100% 逐键逐值一致(${paletteCount} 套配色,各 ${PALETTE_TOKEN_KEYS.length} 个令牌)`,
  );
}

if (hasDrift) process.exit(1);
