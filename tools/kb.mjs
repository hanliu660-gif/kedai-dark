// Kedai 酒馆兼容知识库 —— 查询 CLI
// 用法:
//   node tools/kb.mjs list                        列出全部条目(表格)
//   node tools/kb.mjs query [--domain X] [--priority P0|P1|P2] [--kedai differs|missing|partial|match] [--authority doc|src]
//   node tools/kb.mjs show <id>                   单条详情(JSON)
//   node tools/kb.mjs gaps [--domain X]           Kedai 缺口清单(missing + differs + partial),按优先级排
//   node tools/kb.mjs stats                       统计
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRIES = path.join(ROOT, 'kb', 'entries');

const loadAll = () => {
  if (!existsSync(ENTRIES)) return [];
  return readdirSync(ENTRIES)
    .filter((n) => n.endsWith('.json'))
    .map((n) => {
      try { return JSON.parse(readFileSync(path.join(ENTRIES, n), 'utf8')); }
      catch { return null; }
    })
    .filter(Boolean);
};

const argv = process.argv.slice(2);
const cmd = argv[0];
const flags = {};
for (let i = 1; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const k = a.slice(2);
    const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    flags[k] = v;
  }
}
const positional = argv.slice(1).filter((a) => !a.startsWith('--') && a !== flags.domain && a !== flags.priority && a !== flags.kedai && a !== flags.authority);

const all = loadAll();
const P_ORDER = { P0: 0, P1: 1, P2: 2 };

const filter = (list) => list.filter((e) => {
  if (flags.domain && e.domain !== flags.domain) return false;
  if (flags.priority && e.priority !== flags.priority) return false;
  if (flags.kedai && e.kedai?.status !== flags.kedai) return false;
  if (flags.authority && e.authority !== flags.authority) return false;
  return true;
});

const STATUS_ICON = { match: '✅', partial: '🟡', missing: '❌', differs: '⚠️' };

const table = (list) => {
  if (!list.length) { console.log('(无匹配条目)'); return; }
  const w1 = Math.max(...list.map((e) => e.id.length), 3);
  const w2 = Math.max(...list.map((e) => (e.title || '').length), 5);
  console.log(`${'ID'.padEnd(w1)}  P   AUTH  KEDAI     TITLE`);
  console.log(`${'-'.repeat(w1)}  --  ----  --------  ${'-'.repeat(w2)}`);
  for (const e of list.slice().sort((a, b) => P_ORDER[a.priority] - P_ORDER[b.priority] || a.id.localeCompare(b.id))) {
    const st = e.kedai?.status ?? '?';
    console.log(
      `${e.id.padEnd(w1)}  ${e.priority}  ${(e.authority || '?').padEnd(4)}  ${(STATUS_ICON[st] || '') + ' ' + st.padEnd(7)}  ${e.title}`
    );
  }
  console.log(`\n共 ${list.length} 条`);
};

if (cmd === 'list' || cmd === 'query') {
  table(filter(all));
} else if (cmd === 'show') {
  const id = positional[0];
  if (!id) { console.error('用法: node tools/kb.mjs show <id>'); process.exit(2); }
  const hit = all.find((e) => e.id === id);
  if (!hit) { console.error(`未找到条目: ${id}`); process.exit(1); }
  console.log(JSON.stringify(hit, null, 2));
} else if (cmd === 'gaps') {
  const g = filter(all.filter((e) => ['missing', 'differs', 'partial'].includes(e.kedai?.status)));
  console.log('Kedai 缺口清单(missing / differs / partial):\n');
  table(g);
} else if (cmd === 'stats') {
  const s = { total: all.length, byStatus: {}, byPrio: {}, byDomain: {}, byAuth: {} };
  for (const e of all) {
    s.byStatus[e.kedai?.status ?? '?'] = (s.byStatus[e.kedai?.status ?? '?'] ?? 0) + 1;
    s.byPrio[e.priority ?? '?'] = (s.byPrio[e.priority ?? '?'] ?? 0) + 1;
    s.byDomain[e.domain ?? '?'] = (s.byDomain[e.domain ?? '?'] ?? 0) + 1;
    s.byAuth[e.authority ?? '?'] = (s.byAuth[e.authority ?? '?'] ?? 0) + 1;
  }
  console.log(JSON.stringify(s, null, 2));
} else {
  console.log(`Kedai 酒馆兼容知识库

用法:
  node tools/kb.mjs list                       列出全部条目
  node tools/kb.mjs query --domain worldinfo   按域过滤
  node tools/kb.mjs query --priority P0        只看高危
  node tools/kb.mjs query --kedai missing      只看未实现的
  node tools/kb.mjs show <id>                  单条详情
  node tools/kb.mjs gaps [--domain X]          缺口清单
  node tools/kb.mjs stats                      统计

域: worldinfo / macro / regex / prompt / variable / card / sandbox / mvu / stscript
状态: match(已一致) / partial(部分) / missing(未实现) / differs(实现不符)
依据: doc(官方文档·最高) / src(源码补) / community(社区)`);
}
