#!/usr/bin/env node
/**
 * generate-tokens.mjs — 将 web/src/theme/darkTokens.ts 的单一真相源同步生成到 web/src/styles/tokens.css
 *
 * 契约保证（R3 主题声明层并轨）：
 * 1. web/src/theme/darkTokens.ts 是暗色令牌的唯一真相源（SSOT）；
 * 2. 本脚本保证 tokens.css 中的 :root[data-theme='dark'] 块与 darkTokens.ts 保持 100% 同步；
 * 3. 运行：
 *    node tools/generate-tokens.mjs         # 同步更新 tokens.css
 *    node tools/generate-tokens.mjs --check # 校验 tokens.css 是否已同步（CI/门禁使用）
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOKENS_TS = join(ROOT, 'web', 'src', 'theme', 'darkTokens.ts');
const TOKENS_CSS = join(ROOT, 'web', 'src', 'styles', 'tokens.css');

// 从 darkTokens.ts 中提取键值对
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

// 匹配既有的生成块，或既有的 :root[data-theme='dark'] { ... } 块
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

const isCheck = process.argv.includes('--check');

if (isCheck) {
  if (cssContent !== newCss) {
    console.error('[FAIL] tokens.css 中的暗色令牌与 darkTokens.ts 不同步！请运行 node tools/generate-tokens.mjs 更新。');
    process.exit(1);
  }
  console.log(`[OK] tokens.css 与 darkTokens.ts 保持 100% 逐键逐值一致（共 ${tokenMatches.length} 个令牌）`);
} else {
  if (cssContent !== newCss) {
    writeFileSync(TOKENS_CSS, newCss, 'utf8');
    console.log(`[OK] 已成功从 darkTokens.ts 同步 ${tokenMatches.length} 个令牌至 tokens.css`);
  } else {
    console.log(`[OK] tokens.css 已是最新（共 ${tokenMatches.length} 个令牌）`);
  }
}
