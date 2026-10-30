// check-arch 检测逻辑的 fixture 自测(2026-10-24 C-2-0)。
//
// 为什么需要:2026-10-24 审计实测发现 check-arch 有两类假阴性——只认
// `store.x =` 漏掉 `v-model` / `.value =`,只认静态 `from` 漏掉动态
// `import()`;而门禁脚本自身没有测试,改坏了也只能靠跑真实仓库发现。
// 这里用最小源码 fixture 直接覆盖纯函数,不读仓库、不依赖 cwd。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectFrontendModuleSpecs,
  directWrites,
  hasArchAllow,
  hasFileArchAllow,
  resolveFrontendSpecifier,
  storeBindings,
  stripRustCommentsAndStrings,
} from './lib/arch-scan.mjs';

const VUE_FIXTURE = `
const store = useTaskStore();
const { taskFlowId: flowId, draft } = storeToRefs(store);
flowId.value = 'flow-1';
draft.value = 1;
<select v-model.number="flowId" />
<select v-model="store.currentTaskId" />
`;

test('storeToRefs 解构(含别名)与 .value / v-model 直写都能被抓到', () => {
  const bindings = storeBindings(VUE_FIXTURE);
  assert.equal(bindings.get('store'), 'store', 'useXStore 绑定');
  assert.equal(bindings.get('flowId'), 'ref', 'storeToRefs 别名解构');
  assert.equal(bindings.get('draft'), 'ref', 'storeToRefs 同名解构');

  const syntaxes = directWrites(VUE_FIXTURE, bindings).map((h) => h.syntax);
  assert.ok(syntaxes.includes('flowId.value ='), `.value = 漏检:${syntaxes.join(', ')}`);
  assert.ok(syntaxes.includes('draft.value ='), `.value = 漏检:${syntaxes.join(', ')}`);
  assert.ok(
    syntaxes.includes('v-model.number="flowId"'),
    `ref v-model 漏检:${syntaxes.join(', ')}`,
  );
  assert.ok(
    syntaxes.includes('v-model="store.currentTaskId"'),
    `store 字段 v-model 漏检:${syntaxes.join(', ')}`,
  );
});

test('静态 from 与动态 import() 走同一采集入口,动态相对路径能解析出跨代模块', () => {
  const src = `
import Foo from './Foo.vue';
const Bar = () => import('../components/Bar.vue');
const Baz = () => import('@/components/Baz.vue');
`;
  assert.deepEqual(collectFrontendModuleSpecs(src), [
    './Foo.vue',
    '../components/Bar.vue',
    '@/components/Baz.vue',
  ]);

  assert.equal(
    resolveFrontendSpecifier('utils/flowCanvasChunk.ts', '../components/Bar.vue'),
    'components',
    'utils 动态 import 上层 components 必须解析为跨代边',
  );
  assert.equal(resolveFrontendSpecifier('components/settings/a.ts', './Bar.vue'), 'components');
  assert.equal(resolveFrontendSpecifier('components/settings/a.ts', '../AgentFlowCanvas.vue'), 'components');
  assert.equal(resolveFrontendSpecifier('utils/a.ts', './local.ts'), 'utils');
  assert.equal(resolveFrontendSpecifier('utils/a.ts', '../../components/X.vue'), null, '上跳路径不视作同层');
  assert.equal(resolveFrontendSpecifier('utils/a.ts', 'vue'), null, '包名不参与跨代采集');
});

test('arch-allow 只认当前行/上一行且必须写非空理由', () => {
  const sameLine = `a.value = 1; // arch-allow: 运行时同步`;
  assert.equal(hasArchAllow(sameLine, sameLine.indexOf('a.value')), true);

  const prevLine = `// arch-allow: 事件回调\na.value = 1;`;
  assert.equal(hasArchAllow(prevLine, prevLine.indexOf('a.value')), true);

  const twoLinesAway = `a.value = 1; // arch-allow: 理由\n\nb.value = 2;`;
  assert.equal(hasArchAllow(twoLinesAway, twoLinesAway.indexOf('b.value')), false);

  const emptyReason = `a.value = 1; // arch-allow:`;
  assert.equal(hasArchAllow(emptyReason, emptyReason.indexOf('a.value')), false);
});

test('arch-allow-file 只认文件头 20 行且必须写非空理由', () => {
  const header20 = `${Array.from({ length: 19 }, (_, i) => `// ${i}`).join('\n')}
// arch-allow-file: 整文件表单
const x = 1;`;
  assert.equal(hasFileArchAllow(header20), true, '第 20 行的文件级豁免应生效');

  const header21 = `${Array.from({ length: 20 }, (_, i) => `// ${i}`).join('\n')}
// arch-allow-file: 整文件表单
const x = 1;`;
  assert.equal(hasFileArchAllow(header21), false, '第 21 行的文件级豁免不应生效');

  assert.equal(hasFileArchAllow('// arch-allow-file:\nconst x = 1;'), false, '空理由不算');
});

// ===== 规则 J「全文 crate:: 扫描」的剥离逻辑自测（2026-10-30）=====
//
// 背景：规则 J 原先只匹配行首 `use crate::`，Rust 允许在类型标注/表达式/结构体字段里
// 写内联全路径（如 `risk: crate::tools::permissions::ToolRisk`），这类写法完全绕过门禁。
// 升级为全文扫描后，必须先剥离注释与字符串字面量，否则注释里的 crate:: 会被误判成依赖。
// 这组用例锁两件事：①剥离正确（注释/字符串里的 crate:: 不残留）；②行数严格保持
// （报出的「文件:行号」依赖它，错位会让定位失效）。

test('剥离行注释：注释内的 crate:: 不残留，行数保持', () => {
  const src = '// crate::tools::foo\nlet x = 1;';
  const out = stripRustCommentsAndStrings(src);
  assert.equal(out.includes('crate::'), false, '行注释里的 crate:: 应被剥离');
  assert.equal(src.split('\n').length, out.split('\n').length, '行数必须保持');
});

test('剥离块注释（跨行）：crate:: 不残留且换行符全部保留', () => {
  const src = '/* crate::tools::foo\n   second line */\nlet y = 2;';
  const out = stripRustCommentsAndStrings(src);
  assert.equal(out.includes('crate::'), false);
  assert.equal(src.split('\n').length, out.split('\n').length, '块注释内含换行，行数仍须一致');
});

test('剥离普通字符串与原始字符串：内部的 crate:: 不残留', () => {
  const plain = 'let s = "crate::tools::foo";';
  const raw = 'let t = r#"crate::tools::bar"#;';
  assert.equal(stripRustCommentsAndStrings(plain).includes('crate::'), false, '普通字符串应剥离');
  assert.equal(stripRustCommentsAndStrings(raw).includes('crate::'), false, '原始字符串应剥离');
});

test('真实代码里的 crate:: 必须保留（否则门禁会漏检）', () => {
  const src = 'risk: crate::tools::permissions::ToolRisk,';
  const out = stripRustCommentsAndStrings(src);
  assert.equal(out.includes('crate::tools'), true, '真实依赖不能被剥掉');
});

test('生命周期标注不被误判为字符字面量', () => {
  const src = "fn f<'a>(x: &'a str) -> &'a str { x }";
  const out = stripRustCommentsAndStrings(src);
  assert.equal(out.includes("'a"), true, "生命周期 'a 应原样保留");
});

test('未闭合字符串止损：不吞掉后续行', () => {
  const src = 'let s = "oops\nlet z = 9;';
  const out = stripRustCommentsAndStrings(src);
  assert.equal(out.includes('let z = 9;'), true, '未闭合字符串遇到换行应止损，后续代码保留');
});
