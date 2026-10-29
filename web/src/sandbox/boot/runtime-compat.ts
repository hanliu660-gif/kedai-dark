// runtime-compat.ts — 变量路径工具、lodash 子集、宿主几何与存储兼容 API（从 boot-script.ts 拆出）

export function getRuntimeCompatScript(initialGeo: string): string {
  return `// ---- 变量路径工具(防原型污染,与宿主 mvu/variables 一致) ----
const FORBIDDEN=new Set(['__proto__','constructor','prototype']);
const pathGet=(obj,path)=>{if(path==='')return obj;const segs=path.split('.');if(segs.some(s=>FORBIDDEN.has(s)))return undefined;let cur=obj;for(const seg of segs){if(cur===null||cur===undefined)return undefined;if(typeof cur!=='object')return undefined;cur=cur[seg];}return cur;};
const pathSet=(obj,path,value)=>{if(path===''){if(typeof value==='object'&&value!==null)Object.assign(obj,value);return;}const segs=path.split('.');if(segs.some(s=>FORBIDDEN.has(s)))return;let cur=obj;for(let i=0;i<segs.length-1;i++){const seg=segs[i];const next=cur[seg];const isIndex=/^\\d+$/.test(segs[i+1]);if(typeof next!=='object'||next===null){const created=isIndex?[]:{};cur[seg]=created;cur=created;}else{cur=next;}}cur[segs[segs.length-1]]=value;};
// ---- lodash 子集(stat_data 叶子为 [新值,原因],_.get 自动取 [0]) ----
// 镜像:此处 _.get 的解包段(Array.isArray(v)&&v.length>=1 → v[0])与
// mvu/unwrap.ts 的 unwrapStatLeaf 语义同步,改动必须双侧同改。
const _=Object.freeze({
  get:(obj,path,def)=>{let v=pathGet(obj,path);if(Array.isArray(v)&&v.length>=1)v=v[0];return v===undefined||v===null?def:v;},
  set:(obj,path,value)=>{pathSet(obj,path,value);return obj;},
  has:(obj,path)=>{const v=pathGet(obj,path);return v!==undefined;},
  unset:(obj,path)=>{const keys=Array.isArray(path)?path.map(String):String(path).split('.');if(!keys.length)return true;let o=obj;for(let i=0;i<keys.length-1;i++){if(!o||typeof o!=='object')return true;o=o[keys[i]];}if(o&&typeof o==='object')delete o[keys[keys.length-1]];return true;},
  // 类型判断(卡脚本最常用的 11 个):露出日记-0615 的 LLM 模块与状态栏全靠它们分支
  isArray:(v)=>Array.isArray(v),
  isPlainObject:(v)=>{if(!v||typeof v!=='object'||Array.isArray(v))return false;const p=Object.getPrototypeOf(v);return p===Object.prototype||p===null;},
  isObject:(v)=>v!==null&&typeof v==='object',
  isString:(v)=>typeof v==='string',
  isNumber:(v)=>typeof v==='number'&&Number.isFinite(v),
  isBoolean:(v)=>typeof v==='boolean',
  isFunction:(v)=>typeof v==='function',
  isNil:(v)=>v===null||v===undefined,
  isNull:(v)=>v===null,
  isUndefined:(v)=>v===undefined,
  isEmpty:(v)=>{
    if(v===null||v===undefined)return true;
    if(typeof v==='string'||Array.isArray(v))return v.length===0;
    if(v instanceof Map||v instanceof Set)return v.size===0;
    if(typeof v==='object')return Object.keys(v).length===0;
    return true;
  },
  isEqual:(a,b)=>{try{return JSON.stringify(a)===JSON.stringify(b);}catch(_e){return a===b;}},
  clamp:(n,lo,hi)=>Math.min(Math.max(n,lo),hi),
  uniq:(arr)=>Array.isArray(arr)?Array.from(new Set(arr)):[],
  keys:(o)=>(o&&typeof o==='object'?Object.keys(o):[]),
  values:(o)=>(o&&typeof o==='object'?Object.values(o):[]),
  assign:(t,...srcs)=>{const out=t&&typeof t==='object'?t:{};for(const s of srcs)if(s&&typeof s==='object')for(const k in s)out[k]=s[k];return out;},
  cloneDeep:(v)=>{try{return v===undefined?undefined:JSON.parse(JSON.stringify(v));}catch(_e){return v;}},
  sum:(arr)=>Array.isArray(arr)?arr.reduce((a,b)=>a+(Number(b)||0),0):0,
  max:(arr)=>Array.isArray(arr)&&arr.length?Math.max(...arr.map(Number)):undefined,
  min:(arr)=>Array.isArray(arr)&&arr.length?Math.min(...arr.map(Number)):undefined,
});

// ---- 兼容 API ----
const waitGlobalInitialized=()=>Promise.resolve();
const errorCatched=(fn)=>(...args)=>{try{return fn.apply(this,args);}catch(e){warn('脚本回调出错: '+(e&&e.message?e.message:e));}};
// ---- window.parent 门面:沙箱是不透明来源,跨源读父窗口属性(作者脚本常以
// window.parent 当酒馆主窗口:ST_WIN=window.parent 后 ST_WIN.Mvu / ST_WIN.waitGlobalInitialized)
// 会抛 SecurityError,环境检测类逻辑整段 reject 卡死。门面:postMessage 转发真父窗口,
// 其余属性读一律落到沙箱自身 globalThis(Mvu/waitGlobalInitialized/toastr 已挂载,
// 读不到返回 undefined——作者脚本的「检测」语义即判 undefined,正常降级为「未检测到」)。
const __kdRealParent=parent;
const __kdParentFacade=new Proxy({},{
  get:function(_t,k){
    if(k==='postMessage')return function(){return __kdRealParent.postMessage.apply(__kdRealParent,arguments);};
    // 父视口尺寸:作者定位代码(parentWin.innerHeight)要的是宿主窗口,不是容器高度
    if(k==='innerHeight')return __kdGeo.hostH;
    if(k==='innerWidth')return __kdGeo.hostW;
    return globalThis[k];
  },
});
try{
  Object.defineProperty(window,'parent',{configurable:true,enumerable:true,get:function(){return __kdParentFacade;}});
}catch(e){warn('parent 门面安装失败(不影响主流程): '+(e&&e.message?e.message:e));}
// ---- 宿主几何镜像:作者定位代码(wuwa positionOverlay 等)在酒馆里读 iframe 视口高、
//      window.frameElement 位置、document.body 矩形来算可见区中点;本沙箱是 display:none 的
//      隐藏框架,这些值全为 0,悬浮层会漂到视口外。这里把它们统一映射到宿主容器几何,
//      由宿主在 boot 与滚动/resize 时推送(type:'geometry')。
const __kdGeo={top:0,left:0,width:1280,height:720,scrollHeight:720,scrollWidth:1280,hostH:720,hostW:1280};
const __kdSetGeo=function(g){if(!g||typeof g!=='object')return;for(const k in __kdGeo){const v=Number(g[k]);if(Number.isFinite(v))__kdGeo[k]=v;}};
__kdSetGeo(JSON.parse(${JSON.stringify(initialGeo)})||undefined);
try{Object.defineProperty(window,'innerHeight',{configurable:true,get:function(){return __kdGeo.height;}});}catch(_e){}
try{Object.defineProperty(window,'innerWidth',{configurable:true,get:function(){return __kdGeo.width;}});}catch(_e){}
// frameElement:返回宿主容器在宿主视口中的实时矩形(作者靠它感知聊天滚动)
try{Object.defineProperty(window,'frameElement',{configurable:true,get:function(){return {getBoundingClientRect:function(){return {top:__kdGeo.top,left:__kdGeo.left,right:__kdGeo.left+__kdGeo.width,bottom:__kdGeo.top+__kdGeo.height,width:__kdGeo.width,height:__kdGeo.height,x:__kdGeo.left,y:__kdGeo.top};}};}});}catch(_e){}
// document.body/documentElement 矩形 = 容器内容盒(容器自身不滚动,故顶/左恒为 0)
const __kdBodyRect=function(){return {top:0,left:0,right:__kdGeo.width,bottom:__kdGeo.height,width:__kdGeo.width,height:__kdGeo.height,x:0,y:0};};
try{document.body.getBoundingClientRect=__kdBodyRect;Object.defineProperty(document.body,'scrollHeight',{configurable:true,get:function(){return __kdGeo.scrollHeight;}});Object.defineProperty(document.body,'scrollWidth',{configurable:true,get:function(){return __kdGeo.scrollWidth;}});}catch(_e){}
try{if(document.documentElement){document.documentElement.getBoundingClientRect=__kdBodyRect;Object.defineProperty(document.documentElement,'scrollHeight',{configurable:true,get:function(){return __kdGeo.scrollHeight;}});Object.defineProperty(document.documentElement,'scrollWidth',{configurable:true,get:function(){return __kdGeo.scrollWidth;}});}}catch(_e){}
// ---- localStorage 持久化桥(对齐酒馆:源级存储,重载/重渲染后仍在;如 wuwa 协议只需同意一次)。
// sessionStorage 保持会话级内存存储。两个实例必须独立(此前共用一个对象,协议状态互相污染)。
const __kdMakeStorage=function(saved,persist){
  const store=Object.assign({},saved||{});
  const sync=function(op,k,v){if(persist){try{send('local-storage',{op:op,key:k,value:v});}catch(_e){}}};
  return{getItem: function(k){return Object.prototype.hasOwnProperty.call(store,k)?store[k]:null;},setItem: function(k,v){store[k]=String(v);sync('set',k,store[k]);},removeItem: function(k){delete store[k];sync('remove',k);},clear: function(){for(const k in store)delete store[k];sync('clear');},key: function(i){return Object.keys(store)[i]||null;},get length(){return Object.keys(store).length;}};
};
const __kdMemoryStorage=__kdMakeStorage(__kdSavedLocal,true);
const __kdSessionStorage=__kdMakeStorage(null,false);
// ---- toastr stub:作者脚本经 window.parent.toastr 桥接失败(宿主无 toastr)时仍可调用 ----
const toastr=Object.freeze({info:function(m){console.info('[kedai-toastr]',m);},success:function(m){console.info('[kedai-toastr]',m);},warning:function(m){console.warn('[kedai-toastr]',m);},error:function(m){console.warn('[kedai-toastr]',m);},remove:function(){},clear:function(){},options:{}});`;
}
