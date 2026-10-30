// mvu-tavern.ts — MVU 变量视图、事件总线与酒馆 API（从 boot-script.ts 拆出）

export const MVU_TAVERN_SCRIPT = `// ---- stat_data 裸值视图:kedai 存储叶子为 [值,原因] 成对数组,但 MVU 生态脚本
//      (wuwa 浪潮状态栏等)按裸值直接属性读(String(u.是否是漂泊者)==='true'、
//      u.性别||'男')。门面对外返回解包视图:叶子 [x,原因字符串] 取 x,嵌套递归;
//      裸值与真实数组(长度≠2 或第二元素非字符串)原样保留。_.get 对裸值兼容。 ----
// 镜像:__kdUnwrap 是 mvu/unwrap.ts 的 unwrapStatTree 的沙箱内联副本(字符串注入无法 import),
// 语义同步,改动必须双侧同改。源函数 SHA-256 短哈希:6ccd4bda787e(口径见 unwrap.ts,
// 两侧哈希不一致即漂移)。
const __kdUnwrap=function(v){
  if(Array.isArray(v)){
    if(v.length===2&&typeof v[1]==='string')return v[0];
    return v.map(__kdUnwrap);
  }
  if(v&&typeof v==='object'){const o={};for(const k of Object.keys(v))o[k]=__kdUnwrap(v[k]);return o;}
  return v;
};
const __kdStatView=()=>__kdUnwrap(structuredClone(variables.stat_data));
// ---- 消息级变量写回宿主(2026-10-30 变量落库批;2026-10-30 修:根键守卫) ----
// 此前 replaceVariables / insertOrAssignVariables / Mvu.replaceMvuData 只改沙箱内存副本,
// 刷新即丢(「悬浮球里买东西刷新就没了」)。现经 mvu-replace 上送宿主落库,上送**裸值树**,
// 宿主侧 store.replaceMvuVariables 用 wrapStatTree 按旧树同路径包回 [值,原因]。
//
// ⚠️ 为什么必须有 __kdBootStatKeys 守卫(实机回归,勿删):
//   wrapStatTree 只遍历**新树**的键(for(const k of Object.keys(src))),**不保留旧树
//   其它键** —— 它按「整树替换」设计(帧模板链路每次发的就是完整快照)。
//   而酒馆 replaceVariables 的语义是「整树替换」:卡脚本 boot 时调
//   replaceVariables({...}) 后 variables.stat_data 这层结构本身就没了(见下方归一化),
//   若把这种残缺树直接上送,宿主那棵**完整变量树会被整棵覆盖成残缺内容** ——
//   实测后果:整页卡的「行为选项」全部变空、按钮点不动(露出日记等多张卡同时中招)。
//   守卫规则(有原则,不是补丁):MVU 的 stat_data **根键=变量组,正常玩法不会消失**,
//   故「本次上送会丢掉 boot 快照里的任一根键」即判定为不该同步的整树替换,直接跳过。
//   根键集合在模板求值处捕获(boot 快照下发时就是完整树)。
const __kdBootStatKeys=(function(){
  try{
    const s=variables&&variables.stat_data;
    return (s&&typeof s==='object'&&!Array.isArray(s))?Object.keys(s):[];
  }catch(_e){return [];}
})();
const __kdPushVars=function(){
  try{
    const raw=variables;
    const stat=(raw&&typeof raw.stat_data==='object'&&raw.stat_data!==null)?raw.stat_data:raw;
    // 守卫:上送后会让宿主丢根键 ⇒ 这是「整树替换」而非增量,跳过(否则会冲毁宿主变量树)
    if(__kdBootStatKeys.length>0){
      if(!stat||typeof stat!=='object'||Array.isArray(stat))return;
      for(let i=0;i<__kdBootStatKeys.length;i++){
        if(!( __kdBootStatKeys[i] in stat )) return;
      }
      // 再守一道:空树同样会清空宿主,跳过
      if(Object.keys(stat).length===0)return;
    }
    const disp=(raw&&typeof raw.display_data==='object'&&raw.display_data!==null)?raw.display_data:stat;
    send('mvu-replace',{data:{stat_data:__kdUnwrap(structuredClone(stat)),display_data:structuredClone(disp)}});
  }catch(e){/* 宿主未就绪时丢弃,下次读取自会补;调试时经 warn 上报真实原因 */
    try{warn('变量写回上送失败: '+(e&&e.message?e.message:e));}catch(_e){}
  }
};
// ---- 事件总线(状态栏经 eventOn(Mvu.events.VARIABLE_UPDATE_ENDED,…) 订阅变量更新;
//      宿主在应用 UpdateVariable 后广播 mvu-event,此处合并变量树并触发订阅) ----
const __kdEventBus=new Map();
const __kdFireEvent=function(ev,payload){const set=__kdEventBus.get(ev);if(!set)return;set.forEach(function(cb){Promise.resolve().then(function(){cb(payload);}).catch(function(e){warn('事件回调出错: '+(e&&e.message?e.message:e));});});};
const eventOn=function(ev,cb){if(typeof cb!=='function')return function(){};if(!__kdEventBus.has(ev))__kdEventBus.set(ev,new Set());__kdEventBus.get(ev).add(cb);return function(){const s=__kdEventBus.get(ev);if(s)s.delete(cb);};};
const eventOff=function(ev,cb){const s=__kdEventBus.get(ev);if(s)s.delete(cb);};
const eventEmit=function(ev,payload){__kdFireEvent(ev,payload);return Promise.resolve(true);};
const Mvu=Object.freeze({
  getVariables:()=>({stat_data:__kdStatView(),display_data:structuredClone(variables.display_data)}),
  getMvuData:()=>({stat_data:__kdStatView(),display_data:structuredClone(variables.display_data)}),
  waitGlobalInitialized,
  replaceMvuData:(data)=>{if(!data||typeof data!=='object')return;const stat=data.stat_data&&typeof data.stat_data==='object'?data.stat_data:{};variables.stat_data=stat;variables.display_data=(data.display_data&&typeof data.display_data==='object')?data.display_data:stat;__kdPushVars();},
  parseMessage:(text)=>{try{const raw=String(text??'');let cleaned=raw;const m=/<UpdateVariable>[\\s\\S]*?<\\/UpdateVariable>/gi.exec(cleaned);if(m)cleaned=cleaned.slice(0,m.index)+cleaned.slice(m.index+m[0].length);return{cleaned,commands:[]};}catch{return{cleaned:String(text??''),commands:[]};}},
  isDuringExtraAnalysis:false,
  // 事件名常量(对齐 MagVarUpdate 生态)+ 订阅 API(wuwa 状态栏检查 window.eventOn && window.Mvu 后订阅)
  events:Object.freeze({VARIABLE_UPDATE_ENDED:'mag_variable_update_ended',VARIABLE_UPDATE_STARTED:'mag_variable_update_started'}),
  on:eventOn,
  off:eventOff,
  emit:eventEmit,
});
const getAllVariables=()=>({stat_data:__kdStatView(),display_data:structuredClone(variables.display_data)});
// ---- 酒馆变量 API(全局/消息两级):全局级持久化到宿主 localStorage(按角色),状态栏设置跨渲染保留 ----
const getVariables=function(opts){if(opts&&opts.type==='global')return structuredClone(__kdGlobals);return {stat_data:__kdStatView(),display_data:structuredClone(variables.display_data)};};
const replaceVariables=function(vars,opts){
  const isGlobal=!!(opts&&opts.type==='global');
  const t=isGlobal?__kdGlobals:variables;
  if(vars&&typeof vars==='object'){
    for(const k of Object.keys(t))delete t[k];
    for(const k of Object.keys(vars))t[k]=vars[k];
  }
  if(isGlobal)rpc('global-save',__kdGlobals).catch(function(){});
  else __kdPushVars();
  return Promise.resolve();
};
const insertOrAssignVariables=function(vars,opts){
  const isGlobal=!!(opts&&opts.type==='global');
  const t=isGlobal?__kdGlobals:variables.stat_data;
  if(vars&&typeof vars==='object')for(const k of Object.keys(vars))t[k]=vars[k];
  if(isGlobal)rpc('global-save',__kdGlobals).catch(function(){});
  else __kdPushVars();
  return Promise.resolve();
};
// 挂到 window:作者脚本大量检查 window.eventOn / window.Mvu / typeof getVariables(const 不产生 window 属性)
globalThis.$=$;globalThis.jQuery=$;globalThis._=_;
globalThis.Mvu=Mvu;globalThis.getAllVariables=getAllVariables;
globalThis.getVariables=getVariables;globalThis.replaceVariables=replaceVariables;globalThis.insertOrAssignVariables=insertOrAssignVariables;
globalThis.eventOn=eventOn;globalThis.eventOff=eventOff;globalThis.eventEmit=eventEmit;
globalThis.waitGlobalInitialized=waitGlobalInitialized;globalThis.errorCatched=errorCatched;globalThis.toastr=toastr;
// 酒馆运行期裸全局(实测缺口:露出日记-0615 的卡级脚本「悬浮球-0613」「额外请求-0615」
// 一进函数体就调 getScriptId(),缺失即 ReferenceError,整批卡级脚本判失败并显示红字)。
// getScriptId():酒馆里返回当前脚本 id,卡用它做正则绑定/设置面板的键;kedai 无脚本 id
// 概念,给稳定占位值即可(同一会话内一致,卡片按等值判等)。
globalThis.getScriptId=function(){return 'kedai-script';};
// ---- 脚本按钮 + MVU 写变量(酒馆助手 API;悬浮球-0613 的引导段全依赖这两条) ----
// 酒馆里 getButtonEvent(name) = scriptId + '_' + hash(name),按钮栏点击即以该事件名广播
// (酒馆助手 src/store/iframe_runtimes/script.ts:6 getButtonId)。kedai 用同键格式:
// appendInexistentScriptButtons 登记 → 宿主按钮栏渲染(script-buttons 上送) →
// 宿主点击回投 script-button-click → 这里以同名事件广播,脚本侧 eventOn(getButtonEvent(名字)) 才收得到。
const __kdStringHash=function(str){let h=0;for(let i=0;i<String(str).length;i++){h=(h<<5)-h+String(str).charCodeAt(i);h|=0;}return String(h);};
const __kdScriptButtons=[];
const __kdPublishScriptButtons=function(){
  try{send('script-buttons',{buttons:globalThis.getScriptButtons()});}catch(_e){}
};
globalThis.getButtonEvent=function(name){return String(globalThis.getScriptId())+'_'+__kdStringHash(String(name));};
globalThis.getScriptButtons=function(){return __kdScriptButtons.map(function(b){return {name:b.name,visible:!!b.visible};});};
globalThis.appendInexistentScriptButtons=function(param1,param2){
  const list=Array.isArray(param1)?param1:(Array.isArray(param2)?param2:[]);
  for(const b of list){
    if(!b||typeof b.name!=='string')continue;
    if(!__kdScriptButtons.some(function(x){return x.name===b.name;}))__kdScriptButtons.push({name:b.name,visible:b.visible!==false});
  }
  __kdPublishScriptButtons();
  return globalThis.getScriptButtons();
};
globalThis.replaceScriptButtons=function(list){__kdScriptButtons.length=0;return globalThis.appendInexistentScriptButtons(list||[]);};
// updateVariablesWith(mutator, option):MVU 的标准写变量入口——拿全量变量副本跑回调,
// 回调里常用 _.set 改 stat_data,返回值即新变量树。落地走 replaceVariables(消息级/全局级)。
globalThis.updateVariablesWith=function(mutator,opts){
  const isGlobal=!!(opts&&opts.type==='global');
  const draft=isGlobal
    ?structuredClone(__kdGlobals)
    :{stat_data:structuredClone(__kdStatView()),display_data:structuredClone(variables.display_data)};
  let out=draft;
  try{
    const ret=typeof mutator==='function'?mutator(draft):mutator;
    if(ret&&typeof ret==='object')out=ret;
  }catch(e){
    warn('updateVariablesWith 回调出错: '+(e&&e.message?e.message:e));
    return draft;
  }
  if(isGlobal){replaceVariables(out,{type:'global'});return out;}
  if(out&&out.stat_data)replaceVariables({stat_data:out.stat_data,display_data:out.display_data||out.stat_data});
  else replaceVariables(out);
  try{eventEmit(Mvu.events.VARIABLE_UPDATE_ENDED,getAllVariables());}catch(_e){}
  return out;
};
// 楼层写操作:kedai 沙箱没有写聊天的通道(宿主不转发),给同步占位避免整段卡脚本炸掉;
// 首次调用告警一次,便于在控制台区分「卡逻辑没跑」与「跑了但写不进去」。
let __kdChatWriteWarned=false;
const __kdChatWriteStub=function(name){return function(){
  if(!__kdChatWriteWarned){__kdChatWriteWarned=true;warn(name+' 在 kedai 沙箱里不可写(仅占位,不落库)');}
  return Promise.resolve([]);
};};
globalThis.createChatMessages=__kdChatWriteStub('createChatMessages');
globalThis.triggerSlash=__kdChatWriteStub('triggerSlash');
globalThis.getCurrentMessageId=function(){return -1;};
globalThis.getLastMessageId=function(){return -1;};
// 裸全局 getChatMessages:酒馆里是全局函数(状态栏/额外请求脚本直接裸调),沙箱原先只挂了
// TavernHelper.getChatMessages ⇒ 卡脚本报 getChatMessages is not defined(事件回调里抛)。
globalThis.getChatMessages=function(id,opts){
  return typeof TavernHelper==='object'&&TavernHelper&&typeof TavernHelper.getChatMessages==='function'
    ? TavernHelper.getChatMessages(id,opts)
    : Promise.resolve([]);
};
// 酒馆内置宏替换:沙箱没有酒馆的宏引擎,原样返回(作者脚本普遍把它包在 try/catch 里,
// 给个 identity 至少不产生 ReferenceError 噪音,宏文本由卡自己兜底)。
globalThis.substitudeMacros=function(text){return typeof text==='string'?text:String(text??'');};
// SillyTavern:卡级脚本常读 extensionSettings 做插件协作开关。酒馆里是宿主对象;
// **整页卡/前端卡的标准入口是 SillyTavern.getContext()**(真卡实测 6 处调用)⇒ 必须是
// 「带 getContext() 的对象」,不能是静态空壳(否则 TypeError)。
// 取值策略:**首次真正调用才发一次 RPC**(惰性),此后读缓存;启动不预拉,免得每次 boot
// 白耗一次跨进程往返,也避免干扰「启动期 RPC 计数」类断言。
// RPC 不可用 / 宿主未实现该 op 时,静默回退静态形状,**绝不抛错**(卡普遍不做 try/catch)。
globalThis.SillyTavern=globalThis.SillyTavern||(function(){
  var __stCtx={extensionSettings:{},chat:[],characters:[],name1:'user'};
  var __stFetching=false;
  function __stEnsure(){
    if(__stFetching)return;
    __stFetching=true;
    try{ rpc('st-context',{}).then(function(v){
      if(v&&typeof v==='object'){
        __stCtx=Object.assign({},__stCtx,v);
        if(!__stCtx.extensionSettings)__stCtx.extensionSettings={};
        if(!Array.isArray(__stCtx.chat))__stCtx.chat=[];
        if(!Array.isArray(__stCtx.characters))__stCtx.characters=[];
      }
    }).catch(function(){}); }catch(e){ /* rpc 不可用时静默,保持静态形状 */ }
  }
  __stCtx.getContext=function(){ __stEnsure(); return __stCtx; };
  __stCtx.getContextAsync=function(){ return rpc('st-context',{}).then(function(v){
    return (v&&typeof v==='object')?Object.assign({},__stCtx,v):__stCtx;
  }).catch(function(){return __stCtx;}); };
  return __stCtx;
})();
const Dom=Object.freeze({setText:(selector,text)=>rpc('setText',selector,text),setHtml:(selector,html)=>rpc('setHtml',selector,html),setAttribute:(selector,name,value)=>rpc('setAttribute',selector,name,value)});
const fetch=undefined,XMLHttpRequest=undefined,WebSocket=undefined,EventSource=undefined,indexedDB=undefined,caches=undefined,localStorage=__kdMemoryStorage,sessionStorage=__kdSessionStorage;
// ---- 酒馆事件常量(对齐酒馆助手 tavern_events;值即事件总线键) ----
// 广播源现状:MESSAGE_SWIPED 由宿主 swipeMessage 注入;其余常量列出供脚本引用,
// kedai 侧暂无对应语义的广播源不会触发(安全 no-op)。
const tavern_events=Object.freeze({
  MESSAGE_SWIPED:'message_swiped',
  MESSAGE_SENT:'message_sent',
  MESSAGE_RECEIVED:'message_received',
  MESSAGE_EDITED:'message_edited',
  MESSAGE_DELETED:'message_deleted',
  GENERATION_STARTED:'generation_started',
  GENERATION_ENDED:'generation_ended',
  CHAT_CHANGED:'chat_id_changed',
});
// ---- TavernHelper 音频 API(阶段五 5a):8 个方法对齐酒馆 @types/function/audio.d.ts ----
// 沙箱 CSP 断掉媒体加载(media-src 'none'),播放必须经宿主 <audio> 元素;故 setter 类
// (playAudio/pauseAudio/replaceAudioList/appendAudioList/setAudioSettings)fire-and-forget
// 发 'audio' 消息转宿主执行,getter 类从启动拉取的缓存读(就绪前回退默认,与 jQuery 子集
// hasClass 同步降级一致,不阻塞脚本)。启动时 rpc 拉取一次全量音频状态填缓存。
const __kdAudioDefaults={bgm:{enabled:true,mode:'repeat_all',muted:false,volume:50},ambient:{enabled:true,mode:'play_one_and_stop',muted:false,volume:50}};
const __kdAudioEmpty=function(){return {src:'',title:'',playing:false,progress:0};};
const __kdAudioCache={list:{bgm:[],ambient:[]},settings:{bgm:__kdAudioDefaults.bgm,ambient:__kdAudioDefaults.ambient},current:{bgm:__kdAudioEmpty(),ambient:__kdAudioEmpty()}};
rpc('audio-snapshot').then(function(v){
  if(!v||typeof v!=='object')return;
  const L=v.list||{},S=v.settings||{},C=v.current||{};
  __kdAudioCache.list={bgm:Array.isArray(L.bgm)?L.bgm:[],ambient:Array.isArray(L.ambient)?L.ambient:[]};
  __kdAudioCache.settings={
    bgm:S.bgm&&typeof S.bgm==='object'?Object.assign({},__kdAudioDefaults.bgm,S.bgm):__kdAudioDefaults.bgm,
    ambient:S.ambient&&typeof S.ambient==='object'?Object.assign({},__kdAudioDefaults.ambient,S.ambient):__kdAudioDefaults.ambient
  };
  __kdAudioCache.current={
    bgm:C.bgm&&typeof C.bgm==='object'?C.bgm:__kdAudioEmpty(),
    ambient:C.ambient&&typeof C.ambient==='object'?C.ambient:__kdAudioEmpty()
  };
}).catch(function(){});
const __kdAudioTitle=function(url){try{return decodeURIComponent(new URL(url).pathname.split('/').pop()||'')||url;}catch(e){return url;}};
const TavernHelper=Object.freeze({
  playAudio:function(type,audio){send('audio',{op:'playAudio',args:[type,audio&&typeof audio==='object'?audio:null]});},
  pauseAudio:function(type){send('audio',{op:'pauseAudio',args:[type]});},
  getAudioList:function(type){const t=type==='ambient'?'ambient':'bgm';return (__kdAudioCache.list[t]||[]).map(function(x){return {title:(x&&x.title)||'',url:(x&&x.url)||''};});},
  replaceAudioList:function(type,audioList){send('audio',{op:'replaceAudioList',args:[type,Array.isArray(audioList)?audioList:[]]});},
  appendAudioList:function(type,audioList){send('audio',{op:'appendAudioList',args:[type,Array.isArray(audioList)?audioList:[]]});},
  getAudioSettings:function(type){const t=type==='ambient'?'ambient':'bgm';return Object.assign({},__kdAudioDefaults[t]||__kdAudioDefaults[t]);},
  setAudioSettings:function(type,settings){send('audio',{op:'setAudioSettings',args:[type,settings&&typeof settings==='object'?settings:{}]});},
  getCurrentAudio:function(type){const t=type==='ambient'?'ambient':'bgm';const c=__kdAudioCache.current[t]||__kdAudioEmpty();return {src:c.src||'',title:c.title||'',playing:!!c.playing,progress:typeof c.progress==='number'?c.progress:0};},
  // ---- 事件与工具(卡级脚本依赖面:舰娘卡 swipe 世界书开关联动) ----
  errorCatched:errorCatched,
  eventOn:eventOn,
  eventOff:eventOff,
  eventEmit:eventEmit,
  // ---- 世界书(经宿主 RPC 读/写角色内嵌 character_book;写仅放行 uid+enabled 白名单) ----
  // getCurrentCharPrimaryLorebook 是同步接口:主世界书名随 boot 下发(__KD_LOREBOOK__),
  // 与 kedai 资源帧 shim 的 getCharWorldbookNames 同源(角色卡内嵌世界书即主世界书)
  getCurrentCharPrimaryLorebook:function(){return __KD_LOREBOOK__;},
  getCharWorldbookNames:function(){return __KD_LOREBOOK__?{primary:__KD_LOREBOOK__,additional:[]}:null;},
  getLorebookEntries:function(name){if(!__KD_LOREBOOK__||String(name)!==__KD_LOREBOOK__)return Promise.resolve(null);return rpc('lorebook-entries',String(name));},
  getWorldbook:function(name){return this.getLorebookEntries(name);},
  setLorebookEntries:function(name,list){if(!__KD_LOREBOOK__||String(name)!==__KD_LOREBOOK__)return Promise.resolve(false);return rpc('lorebook-set',String(name),Array.isArray(list)?list:[]);},
  updateWorldbookWith:function(name,fn){const self=this;return self.getLorebookEntries(name).then(function(entries){if(!entries||typeof fn!=='function')return entries;const next=fn(entries.map(function(e){return e;}));return Array.isArray(next)?self.setLorebookEntries(name,next).then(function(){return next;}):entries;});},
  // ---- 聊天消息读取(楼层序号 0-based;include_swipe 带 swipes/swipe_id) ----
  getChatMessages:function(id,opts){return rpc('chat-messages',Number(id)||0,opts&&typeof opts==='object'?opts:{});},
});
globalThis.TavernHelper=TavernHelper;
// ---- kedai 扩展能力(Kedai 命名空间;悬浮窗/面板类脚本的宿主管理桥) ----
// 酒馆悬浮窗的常见功能是管理「预设条目」;在 kedai 里对应物是**提示词注入楼层**。
// 该桥只暴露保守面:读楼层摘要(顺序/角色/启停/字数,**不含正文**)与单条启停写入;
// 能力清单 capabilities 供脚本先探测再降级(缺能力时显示「需平台支持」而不是静默失败)。
const Kedai=Object.freeze({
  capabilities:Object.freeze({floors:true,chatWrite:false,network:false,generate:false}),
  getFloors:function(){return rpc('floors-get');},
  setFloorEnabled:function(id,enabled){return rpc('floors-set-enabled',String(id??''),!!enabled);},
});
globalThis.Kedai=Kedai;
// ---- 剪贴板桥(实跑问题 7 R4)----
// 沙箱是不透明来源 + display:none 隐藏框架,无焦点/无用户激活,navigator.clipboard.writeText
// 与 document.execCommand('copy') 都不可能成功(权限与焦点双缺),「复制提示词」类按钮静默失效。
// 这里覆写 navigator.clipboard,把写入经 RPC 转给宿主页面执行(宿主页有真实用户手势与
// clipboard-write 权限);文本型写入放行,其余(读剪贴板等)不提供。
try{
  const __kdWriteItems=function(items){
    try{
      const arr=Array.isArray(items)?items:[];
      const jobs=[];
      for(const it of arr){
        // 仅支持纯文本 ClipboardItem(getType('text/plain') 返回 Blob/Promise)
        if(it&&typeof it.getType==='function'){
          jobs.push(Promise.resolve(it.getType('text/plain')).then(function(blob){
            return blob&&typeof blob.text==='function'?blob.text():String(blob??'');
          }));
        }
      }
      if(jobs.length===0)return Promise.resolve(true);
      return Promise.all(jobs).then(function(texts){
        return rpc('clipboard-write',texts.filter(Boolean).join('\\n'));
      });
    }catch(e){return Promise.resolve(false);}
  };
  const __kdClipboard={
    writeText:function(text){return rpc('clipboard-write',String(text??''));},
    write:__kdWriteItems,
  };
  Object.defineProperty(navigator,'clipboard',{configurable:true,enumerable:true,get:function(){return __kdClipboard;}});
}catch(e){warn('剪贴板桥安装失败(不影响主流程): '+(e&&e.message?e.message:e));}
// 降级路径:document.execCommand('copy') 转宿主剪贴板桥(旧卡脚本用)
try{
  const __kdExec=document.execCommand?document.execCommand.bind(document):null;
  document.execCommand=function(cmd){
    if(String(cmd)==='copy'){
      // 取当前选区文本(沙箱内选区);无选区时由调用方先 select(),此处尽力读取。
      // 返回值对齐原生语义:真的派发了文本才算成功。此前无条件 return true 会让
      // 作者脚本的 try 分支照常弹「已复制」,而剪贴板其实没有内容(与 clipboard-write
      // 桥同一类谎报问题);取不到文本时返回 false,落到作者脚本的 catch 分支。
      let text='';try{text=String(globalThis.getSelection?globalThis.getSelection():'')||'';}catch(_e){}
      if(!text)return false;
      void rpc('clipboard-write',text).catch(function(){});
      return true;
    }
    return __kdExec?__kdExec.apply(document,arguments):false;
  };
}catch(_e){}
// tavern_events 在 TavernHelper 同区定义(后于上方事件总线挂载区),此处挂载避开 TDZ
globalThis.tavern_events=tavern_events;`;
