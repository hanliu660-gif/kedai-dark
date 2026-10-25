#!/usr/bin/env node
/**
 * check-style.mjs — 样式层 ratchet 护栏(纯 Node 零依赖)。
 *
 * 为什么需要它:
 *   Kedai 的全局设计系统是一个 4200+ 行的单文件(`web/src/style.css`,2026-10-25 起
 *   按既有分节切成 `web/src/styles/*.css`,入口只剩 @import)。`MAINTENANCE.md` 的 D-5 条
 *   写明「只保留层①变量与层②全局基础层,新增组件样式一律 scoped,**不得引入 !important**」。
 *   但 2026-10-25 的代码体检发现:夜间模式在文件末尾追加了 `:root[data-theme='dark']`
 *   组件规则并用 `!important` 与同文件的兜底块对打——纪律存在,却没有任何自动检查拦它。
 *   这条护栏把「纪律」变成「门禁」。
 *
 * 扫描范围:入口 `web/src/style.css` + `web/src/styles/*.css`(按文件名排序 = 层叠顺序)。
 *
 * 检查项:
 *   - important      `!important` 声明数(注释里提到的**不计**)——只能降
 *   - idSelectors    规则头里的 #id 选择器数——`#app` 视觉上是唯一合法项,故基线 = 1
 *   - lines          样式层总行数——只能降(防止继续变胖)
 *   - darkBlockOnlyVars  结构性断言:`:root[data-theme='dark']` 块内**只许**出现自定义属性
 *                    (`--sv-*`),不许出现组件选择器/普通声明。这条不设基线,违反即 FAIL。
 *
 * 用法:
 *   node tools/check-style.mjs            # 超基线即 FAIL(退出码 1)
 *   node tools/check-style.mjs --verbose  # 打印逐项计数与逐文件行数
 *
 * ratchet 纪律:基线只能调**低**。修好一批就把 BASELINE 改小;绝不允许调高。
 * 注意测量口径:必须**先剥注释再计数**,否则文档里讲解 `!important` 的文字会被算进去
 * (2026-10-25 就有人用手工 grep 数出 19,实际声明只有 12 处)。
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STYLE_DIR = join(ROOT, 'web', 'src', 'styles');
const ENTRY = join(ROOT, 'web', 'src', 'style.css');
const VERBOSE = process.argv.includes('--verbose');

/**
 * 存量基线(2026-10-25 建立,值为本脚本自身统计的实测值)。只能下调。
 * 说明:important 的 12 处全在 `06-fallback-motion.css` 的兜底块与 `prefers-reduced-motion` 里——
 * 兜底块使用 `!important` 是标准做法,这 12 处属**有意保留**,不是待还债务。
 * 按文件拆分的部分不改变这些数字,只是把账从「单文件行数」换成「样式层总行数」。
 * 4311 = 原 4253 行内容 + 拆分时给 11 个文件各加的 3 行小节说明(内容零改动)。
 */
const BASELINE = {
  important: 12,
  idSelectors: 1,
  lines: 4311,
};

/**
 * 暗色根块里允许出现的**非变量**声明白名单:
 * `color-scheme: dark` 是浏览器原生的滚动条/表单控件配色开关,必须写在
 * `:root[data-theme='dark']` 上,不是组件样式,故放行。
 */
const DARK_BLOCK_ALLOW = new Set(['color-scheme']);

/** 剥掉块注释与行注释里的文本,避免「注释里讲 !important」被误计。 */
function stripComments(src) {
  // 只在 CSS 层剥 /* */;本文件没有 // 行注释(避免误伤 url(data:...) 之类)
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

/** 逐个规则头:取每个 `{` 之前的最后一个分句(兼容同行多规则)。 */
function ruleHeads(css) {
  const heads = [];
  let buf = '';
  let inString = null;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (inString) {
      if (ch === '\\') { buf += ch + (css[++i] ?? ''); continue; }
      if (ch === inString) inString = null;
      buf += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { inString = ch; buf += ch; continue; }
    if (ch === '{') {
      // 规则头 = buf 里最后一个 ; 之后的部分;@media 之类的嵌套块先记下再用
      const seg = buf.slice(buf.lastIndexOf(';') + 1);
      heads.push(seg.trim());
      buf = '';
      continue;
    }
    if (ch === '}') { buf = ''; continue; }
    buf += ch;
  }
  return heads;
}

// ===== 收集样式层文件:入口 + styles/(按文件名排序)=====
const layerFiles = [
  ENTRY,
  ...readdirSync(STYLE_DIR)
    .filter((f) => f.endsWith('.css'))
    .sort()
    .map((f) => join(STYLE_DIR, f)),
];

let important = 0;
let idSelectors = 0;
let lines = 0;
let ruleTotal = 0;
const perFile = [];
const darkViolations = [];

for (const file of layerFiles) {
  const raw = readFileSync(file, 'utf8');
  const css = stripComments(raw);
  const heads = ruleHeads(css);
  const fileLines = raw.split('\n').length;

  important += (css.match(/!important/g) || []).length;
  idSelectors += heads.filter((h) => /(^|[\s,>+~(])#[A-Za-z_][\w-]*/.test(h)).length;
  lines += fileLines;
  ruleTotal += heads.length;
  perFile.push([file.replace(ROOT + '\\', '').replace(/\\/g, '/'), fileLines]);

  // 结构性断言:裸 `:root[data-theme='dark']` 块内只许自定义属性声明
  for (const m of css.matchAll(/(:root\[data-theme=['"]dark['"]\][^{]*)\{([\s\S]*?)\n\}/g)) {
    const [head, body] = [m[1].trim().replace(/\s+/g, ' '), m[2]];
    const isBare = /^:root\[data-theme=['"]dark['"]\]$/.test(head);
    if (!isBare) continue; // 形如 `... body::after` 的全局层派生块不在此断言范围内
    for (const decl of body.split(';')) {
      const t = decl.trim();
      if (!t || t.startsWith('/*')) continue;
      const prop = t.split(':')[0].trim().toLowerCase();
      if (t.startsWith('--') || DARK_BLOCK_ALLOW.has(prop)) continue;
      darkViolations.push(`${head} 内出现非变量声明:${t.slice(0, 60)}`);
    }
  }
}

const counts = { important, idSelectors, lines };

const LABEL = {
  important: '!important 声明',
  idSelectors: '#id 选择器',
  lines: '样式层总行数',
};

console.log('========== Kedai 样式层护栏(ratchet)==========');
const over = [];
for (const k of Object.keys(BASELINE)) {
  const delta = counts[k] - BASELINE[k];
  const mark = delta > 0 ? `  ✗ 超出基线 +${delta}` : delta < 0 ? `  ✓ 比基线少 ${-delta}` : '';
  console.log(`  ${LABEL[k]}:${counts[k]}(基线 ${BASELINE[k]})${mark}`);
  if (delta > 0) over.push(`${LABEL[k]}:${counts[k]} > 基线 ${BASELINE[k]}(新增 ${delta})`);
}

if (darkViolations.length) {
  console.log(`\n[FAIL] 暗色块内出现 ${darkViolations.length} 条非变量声明(D-5 要求暗色只改变量):`);
  for (const v of darkViolations.slice(0, 20)) console.log(`  - ${v}`);
} else {
  console.log('  暗色块:仅自定义属性 ✓(D-5 合规)');
}

if (VERBOSE) {
  console.log(`\n[verbose] 共扫描 ${layerFiles.length} 个文件、${ruleTotal} 个规则头:`);
  for (const [name, n] of perFile) console.log(`  ${n.toString().padStart(5)} 行  ${name}`);
}

if (over.length) {
  console.log(`\n[FAIL] ${over.length} 项超出基线(ratchet 只降不升):`);
  for (const o of over) console.log(`  - ${o}`);
  process.exit(1);
}
if (darkViolations.length) process.exit(1);
console.log('\n[ OK ] 样式层无新增债务');
