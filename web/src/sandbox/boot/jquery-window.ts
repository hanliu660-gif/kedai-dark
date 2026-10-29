// jquery-window.ts — 宿主 window 门面与挂载类 DOM 操作（从 boot-script.ts 拆出）

export const JQUERY_WINDOW_SCRIPT = `// ---- 宿主 window 门面:作者脚本把 mousemove/mouseup 挂在 window 上收尾拖拽
// (露出日记-0615 悬浮球原文 J=()=>a.ownerDocument?.defaultView??window;
//  n=J(); n.addEventListener('mousemove',me); n.addEventListener('mouseup',he)),
// 沙箱自己的 window 永远收不到宿主事件 ⇒ 这类面板「按下有反应、抬起没反应」。
// 门面把 window 级监听转成宿主 window 绑定(ref kind:'window'),事件经 jq-event 回到沙箱。
const __kdHostWinEvents={mousedown:1,mouseup:1,mousemove:1,click:1,dblclick:1,contextmenu:1,pointerdown:1,pointerup:1,pointermove:1,pointercancel:1,touchstart:1,touchend:1,touchmove:1,keydown:1,keyup:1,keypress:1,resize:1,scroll:1,blur:1,focus:1,dragover:1,drop:1,wheel:1,paste:1};
const __kdBindHostWindow=function(name,fn){
  const evt=String(name||'').trim();
  if(!evt||typeof fn!=='function'||!__kdHostWinEvents[evt])return false;
  const id=++jqIdSeq;
  jqHandlers.set(id,fn);
  enqueue({ref:{kind:'window'},method:'on',args:[evt,id,null]});
  return true;
};
const __kdHostDocumentFacade={
  defaultView:null,
  addEventListener:function(name,fn){
    if(typeof fn!=='function')return;
    const id=++jqIdSeq;
    jqHandlers.set(id,fn);
    enqueue({ref:{kind:'document'},method:'on',args:[String(name||''),id,null]});
  },
  removeEventListener:function(name){enqueue({ref:{kind:'document'},method:'off',args:[String(name||'')]});},
  createElement:function(tag){try{return document.createElement(tag);}catch(_e){return null;}},
  get body(){return null;},
  get documentElement(){return null;},
};
const __kdHostWindowFacade={
  addEventListener:function(name,fn){__kdBindHostWindow(name,fn);},
  removeEventListener:function(name){if(__kdHostWinEvents[String(name||'')])enqueue({ref:{kind:'window'},method:'off',args:[String(name)]});},
  dispatchEvent:function(){return true;},
  getComputedStyle:function(el){return (el&&el.style)||{};},
  scrollTo:function(){},
  setTimeout:function(fn,ms){return setTimeout(fn,ms);},
  setInterval:function(fn,ms){return setInterval(fn,ms);},
  clearTimeout:function(id){return clearTimeout(id);},
  clearInterval:function(id){return clearInterval(id);},
};
__kdHostDocumentFacade.defaultView=__kdHostWindowFacade;
__kdHostWindowFacade.document=__kdHostDocumentFacade;
// 作者脚本也可能直接 window.addEventListener(绕过 ownerDocument 链路):同样补绑宿主。
// 沙箱自己的 window 收不到宿主事件,补绑不会造成双触发。
try{
  const __kdWinAdd=window.addEventListener.bind(window);
  const __kdWinRemove=window.removeEventListener.bind(window);
  Object.defineProperty(window,'addEventListener',{configurable:true,writable:true,value:function(name,fn,opt){
    const r=__kdWinAdd(name,fn,opt);__kdBindHostWindow(name,fn);return r;
  }});
  Object.defineProperty(window,'removeEventListener',{configurable:true,writable:true,value:function(name,fn,opt){
    const r=__kdWinRemove(name,fn,opt);
    if(__kdHostWinEvents[String(name||'')])enqueue({ref:{kind:'window'},method:'off',args:[String(name)]});
    return r;
  }});
}catch(_e){warn('window 事件门面安装失败(窗口级拖拽收尾可能失效): '+(_e&&_e.message?_e.message:_e));}
let __kdElSeq=0;
const __kdNativeHooks=typeof WeakMap==='function'?new WeakMap():null;
const __kdHookOf=function(el){
  if(!el||typeof el!=='object'||!__kdNativeHooks)return null;
  return __kdNativeHooks.get(el)||null;
};
// 钩子上的样式累积:未挂载时只记(outerHTML 序列化会带上),挂载后按 kdId 补发
const __kdSyncHookStyle=function(h){
  if(!h)return;
  if(h.spec&&h.spec.css)for(const k in h.style)h.spec.css[k]=String(h.style[k]);
  if(h.mounted&&h.spec&&h.spec.kdId){
    for(const k in h.style)enqueue({ref:{kind:'kdel',id:h.spec.kdId},method:'css',args:[k,String(h.style[k])]});
  }
};
// 几何真值:kdel 元素在宿主里的 rect(每批 mirror.rects 回传)。沙箱里的节点是宿主 DOM
// 的克隆、永不挂载,原生 getBoundingClientRect 恒为 0,0 ⇒ 悬浮球拖拽用
// a.getBoundingClientRect() 求抓取偏移会退化成「按下点绝对坐标」,按下瞬间球左上角
// 被贴到光标上(实测 cursor 走 +120/+80,球只走 dx=72)。
const __kdRects={};
const __kdRectOf=function(kd){
  const r=kd?__kdRects[kd]:null;
  const left=Number(r&&r.left)||0, top=Number(r&&r.top)||0;
  const width=Number(r&&r.width)||0, height=Number(r&&r.height)||0;
  return {top:top,left:left,width:width,height:height,right:left+width,bottom:top+height,x:left,y:top};
};
const __kdElemToSpec=function(el){
  let html='';
  try{html=typeof el.outerHTML==='string'?el.outerHTML:'';}catch(_e){html='';}
  const spec={kind:'created',html:html,handlers:[],children:[],kdId:'kd'+String(++__kdElSeq)};
  const h=__kdHookOf(el);
  if(h){
    // 已挂载元素的样式在 outerHTML 里;这里保留累积表,后续改动继续补发。
    // 但宿主落 DOM 前会做 style 声明级清洗,显式带 css 更稳(display/position 这类关键样式不丢)。
    for(const x of h.handlers)spec.handlers.push({evt:x.evt,jqId:x.jqId,selector:null});
    if(Object.keys(h.style).length)spec.css=Object.assign({},h.style);
    h.spec=spec;
  }
  return spec;
};
// spec 落到目标上:目标可为 created 集合(嵌套进 children)、选择器串、或 ref 句柄
const __kdAppendSpec=function(spec,target){
  if(target&&target.__kdSpec){
    const p=target.__kdSpec;
    if(p.mounted&&p.kdId)enqueue({ref:{kind:'kdel',id:p.kdId},method:'appendCreated',args:[spec]});
    else p.children.push(spec);
    spec.mounted=true;
    return;
  }
  if(target&&typeof target.__kdRefGet==='function'){
    const r=target.__kdRefGet();
    if(r){enqueue({ref:r,method:'appendCreated',args:[spec]});spec.mounted=true;return;}
  }
  if(typeof target==='string'){enqueue({ref:{kind:'selector',value:target},method:'appendCreated',args:[spec]});spec.mounted=true;return;}
  if(target&&target.kind){enqueue({ref:target,method:'appendCreated',args:[spec]});spec.mounted=true;}
};
try{
  const __kdNativeCreate=document.createElement.bind(document);
  Object.defineProperty(document,'createElement',{configurable:true,writable:true,value:function(tag,opts){
    const el=__kdNativeCreate(tag,opts);
    try{
      const hooks={handlers:[],spec:null,mounted:false,style:{}};
      Object.defineProperty(el,'__kdNativePatched',{value:true,configurable:true});
      // ownerDocument 指宿主文档门面:作者脚本用 ownerDocument.defaultView 找窗口绑收尾
      // 监听(拖拽必备),原生 ownerDocument 会落到沙箱自己的 window,宿主事件永远不来。
      try{Object.defineProperty(el,'ownerDocument',{configurable:true,get:function(){return __kdHostDocumentFacade;}});}catch(_e){}
      const origAdd=typeof el.addEventListener==='function'?el.addEventListener.bind(el):null;
      Object.defineProperty(el,'addEventListener',{configurable:true,writable:true,value:function(evt,fn,capture){
        if(typeof fn!=='function'){if(origAdd)return origAdd(evt,fn,capture);return;}
        const id=++jqIdSeq;jqHandlers.set(id,fn);
        const name=String(evt);
        // 已挂载:直接在宿主真实节点上绑(事件以 jq-event 回发);未挂载:登记进 spec
        if(hooks.mounted&&hooks.spec&&hooks.spec.kdId)enqueue({ref:{kind:'kdel',id:hooks.spec.kdId},method:'on',args:[name,id,null]});
        else hooks.handlers.push({evt:name,jqId:id});
      }});
      const nativeStyle=el.style;
      const styleProxy=new Proxy({},{get:function(_t,k){
        if(k==='setProperty')return function(p,v){hooks.style[String(p)]=String(v);try{if(nativeStyle)nativeStyle.setProperty(p,String(v));}catch(_e){}__kdSyncHookStyle(hooks);};
        if(k==='removeProperty')return function(p){delete hooks.style[String(p)];try{if(nativeStyle)nativeStyle.removeProperty(p);}catch(_e){}__kdSyncHookStyle(hooks);};
        if(k==='getPropertyValue')return function(p){return hooks.style[String(p)]||'';};
        if(k==='cssText')return '';
        if(k==='item')return function(){return '';};
        if(k==='length')return 0;
        return hooks.style[k]!==undefined?hooks.style[k]:'';
      },set:function(_t,k,v){
        hooks.style[String(k)]=String(v);
        try{if(nativeStyle)nativeStyle[String(k)]=String(v);}catch(_e){}
        __kdSyncHookStyle(hooks);
        return true;
      }});
      Object.defineProperty(el,'style',{configurable:true,get:function(){return styleProxy;},set:function(v){
        if(v&&typeof v==='object'){for(const k in v){hooks.style[k]=String(v[k]);try{if(nativeStyle)nativeStyle[k]=String(v[k]);}catch(_e){}}
          __kdSyncHookStyle(hooks);}
      }});
      if(__kdNativeHooks)__kdNativeHooks.set(el,hooks);
      // 几何门面:原生 createElement 造出来的节点同样只在宿主里真实存在
      try{
        Object.defineProperty(el,'getBoundingClientRect',{configurable:true,writable:true,value:function(){
          const h=(__kdNativeHooks&&__kdNativeHooks.get(this))||hooks;
          return __kdRectOf(h&&h.spec?h.spec.kdId:'');
        }});
        Object.defineProperty(el,'offsetWidth',{configurable:true,get:function(){return __kdRectOf(hooks.spec?hooks.spec.kdId:'').width;}});
        Object.defineProperty(el,'offsetHeight',{configurable:true,get:function(){return __kdRectOf(hooks.spec?hooks.spec.kdId:'').height;}});
      }catch(_e){}
    }catch(_e){/* 元素不可改(极少见):退回原生语义,作者脚本自行处理 */}
    return el;
  }});
}catch(e){warn('document.createElement 门面安装失败(作者脚本原生建节点可能不显示): '+(e&&e.message?e.message:e));}
// jQuery 动画方法的效果回调语义:fadeIn(120,cb) / fadeOut(cb) / hide({duration},cb) 里的
// 函数参数必须在动作后异步执行一次。悬浮球「关闭」正是 fadeOut(120,function(){ 把球
// display 显示回来 })——垫片早期把回调整个丢掉,表现就是「点关闭后球永久消失只能刷新」
// (2026-10-29 实跑复现)。没有动画引擎,这里按 duration 直接 setTimeout 触发回调。
const __kdAnimArgs=function(args){
  let ms=0, cb=null;
  for(let i=0;i<args.length;i++){
    const a=args[i];
    if(typeof a==='function')cb=a;
    else if(typeof a==='number')ms=a;
    else if(typeof a==='string'){const n=parseInt(a,10);if(isFinite(n))ms=n;}
    else if(a&&typeof a==='object'&&typeof a.duration==='number')ms=a.duration;
  }
  return {ms:ms, cb:cb};
};
const __kdAnimRun=function(coll,args){
  const p=__kdAnimArgs(args);
  if(!p.cb)return;
  const delay=p.ms>0?Math.min(p.ms,1000):0;
  setTimeout(function(){try{p.cb.call(coll);}catch(__e){send('warn',{message:'动画回调出错: '+((__e&&(__e.message||__e))||'unknown')});}},delay);
};
function jqCreated(spec){
  if(!spec.attrs)spec.attrs={};
  if(!spec.css)spec.css={};
  // 句柄:挂进容器后宿主会写 data-kd-el,沙箱凭 kdId 继续操作同一节点
  // (悬浮球面板 s 在 appendTo 之后才 fadeIn/fadeOut/改 left/top)
  if(!spec.kdId)spec.kdId='kd'+String(++__kdElSeq);
  const kdRef={kind:'kdel',id:spec.kdId};
  const coll={};
  Object.defineProperty(coll,'__kdSpec',{get:function(){return spec;}});
  Object.defineProperty(coll,'__kdRefGet',{get:function(){return function(){return spec.mounted?kdRef:null;};}});
  // 挂载后的操作:spec 已由宿主建成真节点,后续读写要走 kdel 引用才有效
  const live=function(method,args){if(spec.mounted)enqueue({ref:kdRef,method:method,args:args});};
  Object.defineProperty(coll,'length',{get:function(){return 1;}});
  coll.on=function(evt,fn){
    const p=__kdParseOn.apply(null,arguments);
    if(!p)return coll;
    const id=++jqIdSeq;jqHandlers.set(id,p.fn);
    if(spec.mounted)enqueue({ref:kdRef,method:'on',args:[String(p.evt),id,p.selector||null]});
    else spec.handlers.push({evt:String(p.evt),jqId:id,selector:p.selector||null});
    return coll;
  };
  coll.off=function(evt){
    const p=evt?String(evt):'';
    if(spec.mounted)live('off',[p]);
    if(!p)spec.handlers.length=0;
    else spec.handlers=spec.handlers.filter(function(h){return !p.split(/\\s+/).some(function(name){return h.evt===name;});});
    return coll;
  };
  coll.append=function(child){
    if(child&&child.__kdSpec){__kdAppendSpec(child.__kdSpec,coll);return coll;}
    if(child&&typeof child.outerHTML==='string'){const cs=__kdElemToSpec(child);const h=__kdHookOf(child);if(h)h.mounted=true;__kdAppendSpec(cs,coll);return coll;}
    if(typeof child==='string'&&child)spec.innerHtml=(spec.innerHtml||'')+String(child);
    return coll;
  };
  coll.prepend=function(child){
    if(child&&child.__kdSpec){__kdAppendSpec(child.__kdSpec,coll);return coll;}
    if(typeof child==='string'&&child)spec.innerHtml=String(child)+(spec.innerHtml||'');
    return coll;
  };
  // ---- 挂载类 API:jQuery 里 5 个方法,沙箱统一映射成「把 spec 落到目标上」 ----
  // 悬浮球 14 处 appendTo 全走这条($('<div>').appendTo(body) / .appendTo(已创建的父集合))
  const mountTo=function(target){__kdAppendSpec(spec,target);return coll;};
  coll.appendTo=mountTo;
  coll.prependTo=mountTo;
  coll.insertBefore=mountTo;
  coll.insertAfter=mountTo;
  coll.replaceAll=mountTo;
  // after/before:兄弟位置无独立通道,退化为追加(可见性优先,不抛错)
  coll.after=mountTo;
  coll.before=mountTo;
  coll.add=function(){return coll;};
  coll.has=function(){return coll;};
  coll.next=function(){return jq([]);};
  coll.clone=function(){return jq(spec.html||'<div></div>');};
  coll.serialize=function(){return '';};
  coll.stop=function(){
    // 动画队列不存在:stop 只需让后续 fadeIn/fadeOut 立刻生效
    return coll;
  };
  coll.addClass=function(c){spec.addClass=(spec.addClass?spec.addClass+' ':'')+String(c??'');live('addClass',[c]);return coll;};
  coll.removeClass=function(c){live('removeClass',[c]);return coll;};
  coll.toggleClass=function(c,force){live('toggleClass',[c,force]);return coll;};
  coll.text=function(v){if(arguments.length===0)return spec.text||'';spec.text=String(v??'');live('text',[String(v??'')]);return coll;};
  coll.html=function(v){if(arguments.length===0)return spec.innerHtml||'';spec.innerHtml=String(v??'');live('html',[String(v??'')]);return coll;};
  // attr 三种形态:两参写、一参对象合并、一参字符串 getter(游离元素无镜像,返回 '')
  coll.attr=function(k,v){
    if(arguments.length>=2){spec.attrs[String(k)]=String(v??'');live('attr',[String(k),String(v??'')]);return coll;}
    if(k&&typeof k==='object'){for(const key in k){spec.attrs[key]=String(k[key]);live('attr',[key,String(k[key])]);}return coll;}
    const nStr=String(k);
    if(nStr.indexOf('data-')===0){
      const dataKey=nStr.slice(5).replace(/-([a-z])/g,function(_,c){return c.toUpperCase();});
      if(spec.attrs[nStr]!==undefined)return String(spec.attrs[nStr]);
      if(spec.attrs[dataKey]!==undefined)return String(spec.attrs[dataKey]);
    }
    const cur=spec.attrs[nStr];return cur===undefined?'':cur;
  };
  coll.prop=function(){return arguments.length===1?false:coll;};
  // css 三种形态:两参写、一参对象合并、一参字符串读 spec(与真 jQuery 链式语义一致)
  coll.css=function(k,v){
    if(arguments.length>=2){spec.css[String(k)]=String(v??'');live('css',[String(k),String(v??'')]);return coll;}
    if(k&&typeof k==='object'){for(const key in k){spec.css[key]=String(k[key]);live('css',[key,String(k[key])]);}return coll;}
    const cur=spec.css[String(k)];return cur===undefined?'':cur;
  };
  coll.val=function(){return arguments.length===0?'':coll;};
  coll.data=function(name){return String(name)==='ui-draggable'?!!(spec.draggable&&spec.draggable!=='destroy'):'';};
  coll.hasClass=function(){return false;};
  coll.is=function(q){if(q===':visible')return true;if(q===':hidden')return false;return false;};
  coll.find=function(subSel){
    if(typeof subSel!=='string'||!subSel.trim())return jq([]);
    const q=subSel.trim();
    if(spec.kdId)return jq('[data-kd-el="'+spec.kdId+'"] '+q);
    return jq(q);
  };
  coll.closest=function(){return coll;};
  coll.first=function(){return coll;};
  coll.last=function(){return coll;};
  coll.eq=function(){return coll;};
  coll.each=function(cb){if(typeof cb==='function')cb.call(spec,0,spec);return coll;};
  coll.click=function(fn){if(typeof fn==='function')return coll.on('click',fn);live('trigger',['click']);return coll;};
  coll.trigger=function(evt){live('trigger',[String(evt)]);return coll;};
  coll.remove=function(){live('remove',[]);return coll;};
  coll.empty=function(){spec.children.length=0;spec.innerHtml='';live('empty',[]);return coll;};
  coll.show=function(){spec.css.display='';live('css',['display','']);__kdAnimRun(coll,arguments);return coll;};
  coll.hide=function(){spec.css.display='none';live('css',['display','none']);__kdAnimRun(coll,arguments);return coll;};
  coll.toggle=function(show){if(typeof show==='boolean')return show?coll.show():coll.hide();const r=spec.css.display==='none'?coll.show():coll.hide();__kdAnimRun(coll,arguments);return r;};
  // 动画方法(悬浮球面板 fadeIn(120)/fadeOut(120,cb)):无动画引擎,直映射 display;
  // 但**回调必须执行**——卡靠 fadeOut 回调把球重新显示出来(见 __kdAnimRun 注释)
  coll.fadeIn=function(){spec.css.display='';live('css',['display','']);__kdAnimRun(coll,arguments);return coll;};
  coll.fadeOut=function(){spec.css.display='none';live('css',['display','none']);__kdAnimRun(coll,arguments);return coll;};
  coll.slideDown=function(){spec.css.display='';live('css',['display','']);__kdAnimRun(coll,arguments);return coll;};
  coll.slideUp=function(){spec.css.display='none';live('css',['display','none']);__kdAnimRun(coll,arguments);return coll;};
  coll.animate=function(props,ms,cb){
    if(props&&typeof props==='object'){for(const k in props){if(k==='scrollTop'||k==='scrollLeft')live('css',[k,props[k]]);}}
    if(typeof ms==='function')Promise.resolve().then(function(){ms();});
    else if(typeof cb==='function')Promise.resolve().then(function(){cb();});
    return coll;
  };
  coll.focus=function(){live('focus',[]);return coll;};
  coll.outerHeight=function(){return 0;};
  // 游离元素记录 draggable 选项('destroy' 记录为字符串),宿主 appendCreated 落 DOM 时绑指针拖拽
  coll.draggable=function(opts){
    if(typeof opts==='string'){spec.draggable=opts;return coll;}
    const o=opts&&typeof opts==='object'?opts:{};
    const wire={};
    for(const k of ['start','drag','stop']){if(typeof o[k]==='function'){const id=++jqIdSeq;jqHandlers.set(id,o[k]);wire[k]=id;}else wire[k]=0;}
    for(const k of ['handle','cancel','containment','cursor']){if(typeof o[k]==='string')wire[k]=o[k];}
    if(typeof o.distance==='number')wire.distance=o.distance;
    spec.draggable=wire;
    return coll;
  };`;
