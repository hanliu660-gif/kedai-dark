// shared-bridge.ts — 跨 realm 共享全局桥（从 boot-script.ts 拆出）

export function getSharedBridgeScript(initialShared: string): string {
  return `// ---- 跨 realm 共享全局桥(镜像:宿主 sandbox/shared-globals.ts 的键/值校验,语义同步,改动必须双侧同改) ----
// 卡级脚本把纯数据全局挂 window(如 wuwa MVU 卡 window.WuWaShared={STORY_MAP,...}),
// 其余 realm(消息级开场白沙箱)跨源直读不到;这里 diff window 自有可枚举键的
// 新增/引用变化上报宿主(shared-publish),宿主按角色持久化并广播(shared-update)。
const __kdSharedBadKeys=['window','document','top','parent','self','globalThis','frames','location','localStorage','sessionStorage','eval','Function','fetch','XMLHttpRequest','open','close'];
const __kdSharedKeyOk=function(k){return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k)&&__kdSharedBadKeys.indexOf(k)<0&&k.indexOf('__kd')!==0;};
// 值粗筛:JSON 可序列化且序列化 ≤256KB(字符数口径,宿主侧按 UTF-8 字节精确复核)
const __kdSharedJson=function(v){try{const s=JSON.stringify(v);if(typeof s!=='string')return null;if(s.length>262144)return null;return s;}catch(_e){return null;}};
const __kdSharedBaseline=Object.create(null);
// 注入宿主下发快照(先于用户代码,脚本同步可读);注入键并进基线防回声
const __kdSharedInitial=JSON.parse(${JSON.stringify(initialShared)});
for(const __sk in __kdSharedInitial){if(__kdSharedKeyOk(__sk)){try{window[__sk]=__kdSharedInitial[__sk];}catch(_e){}}}
// 基线快照:用户代码运行前 window 自有可枚举键(boot 挂载的 $/Mvu 等收录,diff 不上报)
for(const __bk of Object.keys(window)){try{__kdSharedBaseline[__bk]=window[__bk];}catch(_e){}}
const __kdSharedApply=function(g){
  if(!g||typeof g!=='object')return;
  for(const k in g){if(!__kdSharedKeyOk(k))continue;try{window[k]=g[k];__kdSharedBaseline[k]=window[k];}catch(_e){}}
};
const __kdSharedDiff=function(){
  const out={};let changed=false;
  for(const k of Object.keys(window)){
    if(!__kdSharedKeyOk(k))continue;
    let v;try{v=window[k];}catch(_e){continue;}
    if(Object.prototype.hasOwnProperty.call(__kdSharedBaseline,k)&&__kdSharedBaseline[k]===v)continue;
    const s=__kdSharedJson(v);
    if(s===null)continue; // 函数/循环引用/超大值:跳过(宿主侧同规则再校验一道)
    out[k]=JSON.parse(s);
    try{__kdSharedBaseline[k]=window[k];}catch(_e){}
    changed=true;
  }
  if(changed)send('shared-publish',{globals:out});
};
let __kdSharedTimer=null;
// done 时立即 diff 一次(同步段挂的全局即时上报),之后每 2s 周期 diff(异步挂载兜底);
// 计时器无需显式 clear:沙箱 realm 随 iframe 销毁整体回收
const __kdSharedStart=function(){__kdSharedDiff();if(__kdSharedTimer===null&&typeof setInterval==='function')__kdSharedTimer=setInterval(__kdSharedDiff,2000);};`;
}
