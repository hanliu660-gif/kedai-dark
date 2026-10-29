// boot-script.ts — 沙箱 boot 文档字符串生成(sandboxScript:变量快照/兼容 API/jQuery 子集/事件总线等沙箱内代码的代码生成)
import type { MvuVariables } from '../mvu/variables';
import { CHANNEL, cloneData, type ContainerGeo, type ScriptSegment } from './protocol';
import { MESSAGE_BUS_SCRIPT } from './boot/message-bus';
import { getRuntimeCompatScript } from './boot/runtime-compat';
import { getJqueryCoreScript } from './boot/jquery-core';
import { JQUERY_WINDOW_SCRIPT } from './boot/jquery-window';
import { JQUERY_METHODS_SCRIPT } from './boot/jquery-methods';
import { MVU_TAVERN_SCRIPT } from './boot/mvu-tavern';
import { getSharedBridgeScript } from './boot/shared-bridge';

/**
 * 沙箱 iframe 内容。除基本变量/通信外,内联补全 MagVarUpdate 生态脚本依赖的兼容 API:
 *   - _ (lodash 子集 get/set,叶子 [新值,原因] 自动取 [0])
 *   - $ (jQuery 子集,经 RPC 转发到宿主容器操作 DOM)
 *   - waitGlobalInitialized / errorCatched
 *   - Mvu / getAllVariables / Dom
 * 沙箱是隔离窗口,看不到宿主 window 上的 installMvuGlobals,因此这里必须自带全部全局。
 *
 * code 两种形态:
 *   - string:单段(消息级),用户代码包在 async IIFE 里尾部执行,现行为不变;
 *   - ScriptSegment[]:多段(卡级合并单 realm),boot <script> 之后按序每段一个独立
 *     <script> 标签注入——独立标签天然共享 window 与全局词法环境(语义与 SillyTavern
 *     逐 <script> 加载一致),单段语法错误只废该段不拖垮其余段,段名经
 *     window.__kdScriptName 附到错误上报前缀([卡脚本 段名])。
 */
export function sandboxScript(
  code: string | ScriptSegment[],
  nonce: string,
  variables: MvuVariables,
  globals: Record<string, unknown> = {},
  storage: Record<string, string> = {},
  geo: ContainerGeo | undefined = undefined,
  idMap: Record<string, unknown> = {},
  lorebookName: string | null = null,
  sharedGlobals: Record<string, unknown> = {},
  /** 启动时的宿主表单控件快照(gatherControls):document.getElementById 门面读 select/input
   *  真值的同步数据源(事件回包也会带 controls,此处覆盖脚本 boot 后、首次事件前的裸读)。 */
  controls: Array<Record<string, unknown>> = [],
): string {
  const segments = typeof code === 'string' ? null : code;
  const escapedCode = segments === null ? (code as string).replace(/<\/script/gi, '<\\/script') : '';
  const initialData = JSON.stringify(cloneData(variables)).replace(/</g, '\\u003c');
  const initialGlobals = JSON.stringify(cloneData(globals)).replace(/</g, '\\u003c');
  const initialStorage = JSON.stringify(cloneData(storage)).replace(/</g, '\\u003c');
  const initialGeo = JSON.stringify(geo ?? null).replace(/</g, '\\u003c');
  const initialMirror = JSON.stringify(cloneData(idMap)).replace(/</g, '\\u003c');
  const initialControls = JSON.stringify(cloneData(controls)).replace(/</g, '\\u003c');
  const initialLorebook = JSON.stringify(lorebookName ?? null);
  const initialNonce = JSON.stringify(nonce);
  const initialShared = JSON.stringify(cloneData(sharedGlobals)).replace(/</g, '\\u003c');
  // 多段正文经 JSON 内联(< → < 转义双保险;段文本最终以 textContent 注入,不经 HTML 解析)
  const segmentsJson = JSON.stringify(
    (segments ?? []).map((s) => ({ name: String(s?.name ?? ''), code: String(s?.code ?? '') })),
  ).replace(/</g, '\\u003c');
  const runUserCode = segments === null
    // 单段(消息级):现行为不变,仅在 done 前挂共享桥首次 diff。
    // 额外在用户代码前注册 __kdEvalInline:直接 eval 定义在 IIFE 内,作用域链含用户代码的
    // function 声明与 const 绑定;inline 事件降级桥据此求值(onclick/onchange 里调用卡内函数)。
    ? `(async()=>{try{
const __kdInlineEval=function(__c,__e){var event=__e;return eval(__c);};
window.__kdEvalInline=__kdInlineEval;globalThis.__kdEvalInline=__kdInlineEval;
${escapedCode}
;await flush();__kdSharedStart();send('done')}catch(error){send('error',{message:error instanceof Error?(error.stack||error.message):String(error)})}})();`
    // 多段(卡级合并单 realm):逐段独立 <script> 注入(appendChild 同步执行)。
    // 每段正文包进 async 箭头 IIFE —— 语义对齐 SillyTavern 的 <script type="module">:
    // ①独立词法作用域(段与段之间的顶层 let/const 不再互相 'already been declared',
    //   露出日记-0615 的 12.js/14.js 顶层同名变量曾是整卡脚本全灭的直接原因);
    // ②允许顶层 await(02–11 号脚本 await waitGlobalInitialized('Mvu') 此前是
    //   'await is only valid in async functions' 整段作废);
    // ③跨段通信只走 window(与 module 一致),window.X 赋值照旧可见。
    // 段名单独注入一个 <script>:正文即使解析失败,error 钩子也能报对段名。
    // 内联事件桥:IIFE 内注册 __kdEvalInline,direct eval 作用域链含本段函数/常量声明。
    : `window.__kdScriptName='';
const __kdSegPrefix=function(){return window.__kdScriptName?'[卡脚本 '+window.__kdScriptName+'] ':'';};
addEventListener('error',function(e){
  const em=(e&&e.error&&(e.error.stack||e.error.message))||(e&&e.message)||'未知错误';
  send('warn',{message:__kdSegPrefix()+em});
});
addEventListener('unhandledrejection',function(e){
  const r=e?e.reason:null;
  send('warn',{message:__kdSegPrefix()+'未处理的 Promise 拒绝: '+(r&&r.message?r.message:String(r))});
});
const __kdSegments=JSON.parse(${JSON.stringify(segmentsJson)});
for(let __i=0;__i<__kdSegments.length;__i++){
  const __seg=__kdSegments[__i];
  const __segName=String(__seg.name||'');
  const __tag=document.createElement('script');
  __tag.textContent='window.__kdScriptName='+JSON.stringify(__segName)+';';
  document.head.appendChild(__tag);
  const __s=document.createElement('script');
  // 段主体:async IIFE(独立作用域 + 顶层 await)。catch 里带段名上送 warn,
  // 段间互不阻断;textContent 注入不触发 HTML 解析(无 </script> 闭合风险)。
  __s.textContent='(async()=>{try{\\n'
    +'const __kdInlineEval=function(__c,__e){var event=__e;return eval(__c);};window.__kdEvalInline=__kdInlineEval;\\n'
    +__seg.code
    +'\\n}catch(__e){send(\\'warn\\',{message:'+JSON.stringify('[卡脚本 '+__segName+'] 执行失败: ')+'+(__e&&(__e.stack||__e.message)||String(__e))});}})();';
  document.head.appendChild(__s);
}
window.__kdScriptName='';
(async()=>{try{await flush();__kdSharedStart();send('done')}catch(error){send('error',{message:__kdSegPrefix()+(error instanceof Error?(error.stack||error.message):String(error))})}})();`;
  const preamble = `'use strict';
const CHANNEL=${JSON.stringify(CHANNEL)}, NONCE=${initialNonce};
const variables=JSON.parse(${JSON.stringify(initialData)});
const __kdGlobals=JSON.parse(${JSON.stringify(initialGlobals)});
const __kdSavedLocal=JSON.parse(${JSON.stringify(initialStorage)});
// 主世界书名(角色卡内嵌 character_book.name;无则 null):TavernHelper 世界书 API 的同步数据源
const __KD_LOREBOOK__=${initialLorebook};
`;

  return [
    preamble,
    MESSAGE_BUS_SCRIPT,
    '\n',
    getRuntimeCompatScript(initialGeo),
    '\n',
    getJqueryCoreScript(initialMirror, initialControls),
    '\n',
    JQUERY_WINDOW_SCRIPT,
    '\n',
    JQUERY_METHODS_SCRIPT,
    '\n',
    MVU_TAVERN_SCRIPT,
    '\n',
    getSharedBridgeScript(initialShared),
    '\n',
    runUserCode,
    '\n',
  ].join('');
}
