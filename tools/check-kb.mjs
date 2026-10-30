// Kedai 酒馆兼容知识库 —— 校验器
// 规则:
//   K1 kb/ 必需文件齐备(README.md / schema.json / index.json)
//   K2 每个 entries/*.json 符合 kb/schema.json(手写轻量 JSON Schema 求值器:type/enum/pattern/
//      minLength/maxLength/minItems/required/additionalProperties/properties/items,不引外部依赖)
//   K3 条目 id 全局唯一且与文件名前缀域一致
//   K4 index.json 与 entries/ 双向一致(索引里列了必须存在;存在必须列)
//   K5 sources.ref 必须形如「绝对路径:行号」或 https URL(指路指针,不允许空)
//   K6 许可红线:条目内不得出现上游源码片段(启发式:检测过长的代码状字符串)
//   K7 kedai.evidence 必须能在本仓定位到文件(行号存在性)
//   K8 related 数组里引用的 id 必须都真实存在于 entries/(否则索引图会出现悬空边)
// 退出码:0 全过 / 1 有 FAIL
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KB = path.join(ROOT, 'kb');
const ENTRIES = path.join(KB, 'entries');

const findings = [];
const fail = (rule, msg) => findings.push({ level: 'FAIL', rule, msg });
const warn = (rule, msg) => findings.push({ level: 'WARN', rule, msg });
const oks = [];
const ok = (rule, msg) => oks.push(`[ OK ] ${rule} ${msg}`);

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

// ---------- K1 必需文件 ----------
for (const f of ['README.md', 'schema.json', 'index.json']) {
  const p = path.join(KB, f);
  if (!existsSync(p)) fail('K1', `kb/${f} 缺失`);
}
if (findings.every((f) => f.rule !== 'K1')) ok('K1', 'kb/ 必需文件齐备(3/3)');

// ---------- 载入 schema 与 index ----------
let schema = null;
let index = null;
try { schema = readJson(path.join(KB, 'schema.json')); } catch (e) { fail('K2', `schema.json 解析失败: ${e.message}`); }
try { index = readJson(path.join(KB, 'index.json')); } catch (e) { fail('K3', `index.json 解析失败: ${e.message}`); }

const REQUIRED = schema?.required ?? [];
const props = schema?.properties ?? {};
const DOMAINS = props.domain?.enum ?? [];

// ---- 轻量 JSON Schema 求值器（只实现 kb/schema.json 实际用到的关键字）----
// 支持: type / enum / pattern / minLength / maxLength / minItems / required / additionalProperties / properties / items
// 目的:让 K2 真正按 schema 校验,而不是只查必填与三个枚举(此前 pattern 写了却没人跑 ⇒ 门禁「弱绿」)
const TYPE_CHECKS = {
  object: (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
  array: (v) => Array.isArray(v),
  string: (v) => typeof v === 'string',
};

function validate(node, sch, at) {
  if (!sch || typeof sch !== 'object') return;
  const t = sch.type;
  if (t && TYPE_CHECKS[t] && !TYPE_CHECKS[t](node)) {
    fail('K2', `${at}: 期望类型 ${t},实际 ${Array.isArray(node) ? 'array' : node === null ? 'null' : typeof node}`);
    return;
  }
  if (Array.isArray(sch.enum)) {
    const vals = sch.enum;
    const okEnum = vals.some((x) => JSON.stringify(x) === JSON.stringify(node));
    if (!okEnum) fail('K2', `${at}: 取值不在枚举 ${JSON.stringify(vals)} → ${JSON.stringify(node)}`);
  }
  if (typeof node === 'string') {
    if (typeof sch.minLength === 'number' && node.length < sch.minLength) {
      fail('K2', `${at}: 长度 ${node.length} < minLength ${sch.minLength}`);
    }
    if (typeof sch.maxLength === 'number' && node.length > sch.maxLength) {
      fail('K2', `${at}: 长度 ${node.length} > maxLength ${sch.maxLength}`);
    }
    if (typeof sch.pattern === 'string') {
      let re;
      try { re = new RegExp(sch.pattern); } catch (e) { fail('K2', `${at}: schema.pattern 无法编译 ${sch.pattern}`); return; }
      if (!re.test(node)) fail('K2', `${at}: 不匹配 pattern ${sch.pattern} → ${JSON.stringify(node)}`);
    }
  }
  if (Array.isArray(node)) {
    if (typeof sch.minItems === 'number' && node.length < sch.minItems) {
      fail('K2', `${at}: 数组长度 ${node.length} < minItems ${sch.minItems}`);
    }
    if (sch.items) node.forEach((v, i) => validate(v, sch.items, `${at}[${i}]`));
  }
  if (node !== null && typeof node === 'object' && !Array.isArray(node)) {
    for (const k of sch.required ?? []) {
      if (node[k] === undefined) fail('K2', `${at}: 缺必填字段 ${k}`);
    }
    if (sch.additionalProperties === false && sch.properties) {
      for (const k of Object.keys(node)) {
        if (!(k in sch.properties)) fail('K2', `${at}: 出现 schema 未定义字段 ${k}`);
      }
    }
    for (const [k, sub] of Object.entries(sch.properties ?? {})) {
      if (node[k] !== undefined) validate(node[k], sub, `${at}.${k}`);
    }
  }
}

// ---------- 遍历条目 ----------
const files = existsSync(ENTRIES)
  ? readdirSync(ENTRIES).filter((n) => n.endsWith('.json')).sort()
  : [];
if (!files.length) warn('K2', 'entries/ 为空(尚无条目)');

const ids = new Map(); // id -> file
const indexIds = new Set();
if (index) {
  for (const [dom, d] of Object.entries(index.domains ?? {})) {
    for (const eid of d.entries ?? []) indexIds.add(eid);
  }
}

const CODEISH = [
  /\bfunction\s*\w*\s*\(\s*[^)]*\)\s*\{/,         // 函数体
  /=>\s*\{[\s\S]{60,}/,                            // 箭头函数体
  /\b(?:const|let|var)\s+\w+\s*=\s*[^;]{60,};/,   // 长赋值
  /;\s*\n\s*[a-zA-Z_$]+\.\s*\w+\(/,               // 语句流
  /\breturn\s+[^;\n]{40,};/,                       // 长 return
];

for (const f of files) {
  const p = path.join(ENTRIES, f);
  let e;
  try { e = readJson(p); } catch (err) { fail('K2', `${f}: JSON 解析失败 ${err.message}`); continue; }

  // K2 必填与枚举
  for (const k of REQUIRED) {
    if (e[k] === undefined) fail('K2', `${f}: 缺必填字段 ${k}`);
  }
  if (e.domain && !DOMAINS.includes(e.domain)) fail('K2', `${f}: domain 非法 ${e.domain}`);
  if (e.priority && !['P0', 'P1', 'P2'].includes(e.priority)) fail('K2', `${f}: priority 非法 ${e.priority}`);
  if (e.authority && !['doc', 'src', 'community'].includes(e.authority)) fail('K2', `${f}: authority 非法 ${e.authority}`);
  if (e.kedai?.status && !['match', 'partial', 'missing', 'differs'].includes(e.kedai.status)) {
    fail('K2', `${f}: kedai.status 非法 ${e.kedai.status}`);
  }
  if (!e.sources?.length) fail('K2', `${f}: sources 至少一条`);
  if (!e.kedai?.evidence?.length) fail('K2', `${f}: kedai.evidence 至少一条`);

  // K2-full 逐条按 schema.json 求值(pattern/minLength/maxLength/enum/additionalProperties/嵌套)
  if (schema) validate(e, schema, f);

  // K3 id 唯一 + 域前缀一致
  if (e.id) {
    if (ids.has(e.id)) fail('K3', `${f}: id 重复 ${e.id}(已用于 ${ids.get(e.id)})`);
    else ids.set(e.id, f);
    if (e.domain && !e.id.startsWith(e.domain + '.')) {
      fail('K3', `${f}: id 前缀与 domain 不符 (${e.id} vs ${e.domain})`);
    }
  }

  // K5 sources.ref 形如指针
  for (const s of e.sources ?? []) {
    const ref = s.ref ?? '';
    const isUrl = /^https?:\/\//.test(ref);
    const isPtr = /:(\d+)(-\d+)?$/.test(ref);
    if (!isUrl && !isPtr) fail('K5', `${f}: sources.ref 不是「路径:行号」或 URL → ${ref}`);
    if (!ref.trim()) fail('K5', `${f}: sources.ref 为空`);
  }

  // K6 许可红线:不得含上游源码片段
  const text = JSON.stringify(e);
  for (const re of CODEISH) {
    const m = text.match(re);
    if (m) fail('K6', `${f}: 疑似含源码片段(许可红线) → ${JSON.stringify(m[0].slice(0, 60))}…`);
  }

  // K7 kedai.evidence 可定位
  for (const ev of e.kedai?.evidence ?? []) {
    const m = ev.match(/^([^:]+)(?::(\d+))?/);
    if (!m) { fail('K7', `${f}: evidence 格式非法 ${ev}`); continue; }
    const rel = m[1].trim();
    const abs = path.join(ROOT, rel);
    if (!existsSync(abs)) { fail('K7', `${f}: evidence 文件不存在 ${rel}`); continue; }
    if (m[2]) {
      const lines = readFileSync(abs, 'utf8').split('\n').length;
      const ln = parseInt(m[2], 10);
      if (ln < 1 || ln > lines) fail('K7', `${f}: evidence 行号越界 ${ev}(文件仅 ${lines} 行)`);
    }
  }
}

// ---------- K8 related 引用必须都真实存在(需全部 id 收齐后再查) ----------
{
  const dangling = [];
  for (const f of files) {
    let e;
    try { e = readJson(path.join(ENTRIES, f)); } catch { continue; }
    for (const r of e.related ?? []) {
      if (!ids.has(r)) dangling.push(`${f}: related 指向不存在的条目 ${r}`);
    }
  }
  if (dangling.length) dangling.forEach((m) => fail('K8', m));
  else ok('K8', 'related 引用全部存在');
}

// ---------- K4 双向一致 ----------
if (index) {
  for (const eid of indexIds) {
    if (!ids.has(eid)) fail('K4', `index.json 列了 ${eid} 但 entries/ 无此条目`);
  }
  for (const [eid, f] of ids) {
    if (!indexIds.has(eid)) fail('K4', `entries/${f} 未登记到 index.json`);
  }
  // 域清单与条目 domain 一致
  for (const [eid, f] of ids) {
    const e = readJson(path.join(ENTRIES, f));
    const listed = (index.domains?.[e.domain]?.entries ?? []).includes(eid);
    if (!listed) fail('K4', `${f}: id 未登记在 index.domains.${e.domain}.entries`);
  }
  if (!findings.some((x) => x.rule === 'K4')) ok('K4', `index 与 entries 双向一致(${ids.size} 条)`);
}

// ---------- 汇总 ----------
const fails = findings.filter((f) => f.level === 'FAIL');
const warns = findings.filter((f) => f.level === 'WARN');
for (const o of oks) console.log(o);

const byStatus = { match: 0, partial: 0, missing: 0, differs: 0 };
const byPrio = { P0: 0, P1: 0, P2: 0 };
for (const f of files) {
  try {
    const e = readJson(path.join(ENTRIES, f));
    if (e.kedai?.status) byStatus[e.kedai.status] = (byStatus[e.kedai.status] ?? 0) + 1;
    if (e.priority) byPrio[e.priority] = (byPrio[e.priority] ?? 0) + 1;
  } catch { /* 已单独报 */ }
}

console.log(`\n条目总数: ${files.length}`);
console.log(`按状态: match ${byStatus.match} / partial ${byStatus.partial} / missing ${byStatus.missing} / differs ${byStatus.differs}`);
console.log(`按优先级: P0 ${byPrio.P0} / P1 ${byPrio.P1} / P2 ${byPrio.P2}`);

if (warns.length) {
  console.log(`\n[ WARN ] ${warns.length} 条:`);
  warns.forEach((w) => console.log(`  - [${w.rule}] ${w.msg}`));
}
if (fails.length) {
  console.log(`\n[FAIL] 知识库校验未通过: ${fails.length} 条`);
  fails.forEach((f) => console.log(`  - [${f.rule}] ${f.msg}`));
  process.exit(1);
}
console.log('\n[ OK ] 知识库校验全过(结构 / ID / 双向索引 / 指针 / 许可红线 / evidence 定位)');
