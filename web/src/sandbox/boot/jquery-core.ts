// jquery-core.ts — jQuery 状态镜像、操作队列与 getElementById / 游离元素门面（从 boot-script.ts 拆出）

export function getJqueryCoreScript(initialMirror: string, initialControls: string): string {
  return `// ---- jQuery 子集(同步 API 外观;操作入队,脚本同步段结束后批量 RPC 提交,
//      微任务 flush 保证 getter/setter 链式调用在脚本 await 点前全部发出) ----
// getter 真实化(宿主状态镜像):宿主在每批操作与每个事件回包中附带容器状态
// (批内涉及的选择器状态 + 全部表单控件值),合并进 __kdMirror;getter 从镜像读,
// 使开场协议勾选/确认($('#agree').prop('checked') 等)读到真实值而非假值桩。
// 未命中的选择器 getter 会顺带 enqueue 一次 probe,下一批回包后同选择器即可读到真值。
const jqHandlers=new Map();
// jQuery 事件名规整:剥离命名空间('click.myNS' → 'click')并按空格拆多事件名。
// 旧实现把整串当事件名 addEventListener,带命名空间的绑定永不触发(实跑问题 7 R3)。
const __kdEventNames=(evt)=>String(evt??'').split(/\\s+/).map(function(s){var i=s.indexOf('.');return i<0?s:s.slice(0,i);}).filter(Boolean);
// jQuery on 参数重载:on(evt, fn) 直接绑定;on(evt, selector, fn) 委托绑定
// (动态弹窗/输入框最依赖委托;旧实现把 selector 字符串当回调存入 jqHandlers,
// 事件到来时 fn.call 抛 TypeError 被吞掉,表现即「绑定静默失效」——实跑问题 7 R3)。
// 注意:必须用 function 声明(不能用箭头函数)——下方依赖 arguments 读重载参数。
const __kdParseOn=function(a,b,c){
  if(typeof b==='function')return{evt:a,selector:null,fn:b};
  if(typeof c==='function')return{evt:a,selector:typeof b==='string'&&b?b:null,fn:c};
  return null;
};
// 已应用 draggable 的选择器键集合:data('ui-draggable') 与 destroy 判定用
const jqDraggableApplied={};
const jqReadyQueue=[];
let jqIdSeq=0;
let ops=[];
let flushPromise=null;
// ---- 事件合帧(宿主推来的 jq-event 先入队,一帧只派发一轮) ----
// 拖动/滚动时作者脚本每个鼠标事件都改样式 ⇒ 每事件一次 RPC 往返 + 宿主全量状态镜像,
// 注意:这里**同步派发**,不做任何 rAF/定时器式合帧。
// 沙箱 iframe 是 display:none 且 0×0 的不可见文档,其 realm 里的 requestAnimationFrame
// **永不回调**(2026-10-29 实测:1.5s 只跑 1 帧,Promise 化后 1000ms 超时);一旦用 rAF 排程,
// 队列会永久卡死、所有点击/拖动静默失效(无 exception、无 console.error)。
// 高频事件的合帧放在**宿主侧**做(可见页面 rAF 正常,见 sandbox/host-events.ts)。
const __kdMirror={selectors:JSON.parse(${JSON.stringify(initialMirror)}),controls:JSON.parse(${JSON.stringify(initialControls)})};
// id 反向索引:attr('id') 读复合类选择器('.tab-page.active')时回查。
// jQuery 语义 = 集合首元素的 id;镜像只按「原样选择器串」采集,复合选择器可能从未入镜像,
// 但同族简单选择器('.tab-page' 的 items)与写操作补丁('#page-user' addClass)已在索引里。
const __kdById={};
const __kdIndexState=function(st){if(st&&typeof st.id==='string'&&st.id)__kdById[st.id]=st;};
// 表单控件并入 #id 选择器镜像:controls 携带 val/checked/disabled/selectedIndex/options,
// 而 id 轻量表(initialMirror)只有 classes——门面与 jQuery 子集的 read() 优先读
// __kdMirror.selectors['#id'],不并入就读不到控件真值(实测踩坑)。
const __kdMergeControls=function(list){
  if(!Array.isArray(list))return;
  __kdMirror.controls=list;
  for(const c of list){
    if(!c||typeof c.id!=='string'||!c.id)continue;
    const k='#'+c.id;
    const merged=Object.assign({n:1},__kdMirror.selectors[k]||{},c);
    __kdMirror.selectors[k]=merged;
    __kdIndexState(merged);
  }
};
// boot 注入的 id 轻量表立即入索引(boot 内同步执行的 render 读 attr('id') 时无需等 ack)
for(const __k in __kdMirror.selectors)__kdIndexState(__kdMirror.selectors[__k]);
__kdMergeControls(__kdMirror.controls);
const __kdMergeMirror=function(m){
  if(!m||typeof m!=='object')return;
  const S=m.selectors||{};
  for(const k in S){
    __kdMirror.selectors[k]=S[k];
    __kdIndexState(S[k]);
    if(S[k]&&Array.isArray(S[k].items))S[k].items.forEach(__kdIndexState);
  }
  if(Array.isArray(m.controls))__kdMergeControls(m.controls);
  if(m.rects&&typeof m.rects==='object'){for(const k in m.rects)__kdRects[k]=m.rects[k];}
};
// 复合类选择器回查:'.tab-page.active' / 'div.a.b' → 第一个 classes 全含的元素 id
const __kdByClassLookup=function(sel){
  const m=/^[a-zA-Z][\\w-]*((?:\\.[\\w-]+)+)$/.exec(sel)||/^((?:\\.[\\w-]+)+)$/.exec(sel);
  if(!m)return null;
  const cls=(m[1]||'').split('.').filter(Boolean);
  if(cls.length===0)return null;
  // 优先同源前缀选择器的 items('.tab-page.active' → '.tab-page' 采集快照)
  if(cls.length>1){
    const prefix='.'+cls.slice(0,-1).join('.');
    const pe=__kdMirror.selectors[prefix];
    if(pe&&Array.isArray(pe.items)){
      for(const it of pe.items){
        if(it&&Array.isArray(it.classes)&&it.classes.indexOf(cls[cls.length-1])>=0&&typeof it.id==='string'&&it.id)return it.id;
      }
    }
  }
  for(const id in __kdById){
    const st=__kdById[id];
    if(!st||!Array.isArray(st.classes))continue;
    let ok=true;
    for(const c of cls)if(st.classes.indexOf(c)<0){ok=false;break;}
    if(ok)return id;
  }
  return null;
};
// 事件回包里的 target.state 是事件时刻的真值(滚动度量/勾选态等):按元素 id 合入选择器镜像,
// 事件回调里重新 $() 查询(如 $card[0].scrollTop)读到的是当前值而不是 boot 时的陈值。
const __kdMergeEventTarget=function(t){
  if(!t||typeof t!=='object')return;
  const st=t.state;
  if(!st||typeof st!=='object'||typeof st.id!=='string'||!st.id)return;
  const k='#'+st.id;
  const cur=__kdMirror.selectors[k]||{};
  if(typeof cur.n!=='number')cur.n=1;
  __kdMirror.selectors[k]=Object.assign(cur,st);
};
const __kdFindControl=function(sel){
  if(typeof sel!=='string')return null;
  const C=__kdMirror.controls||[];
  const idM=/(?:^|\\s)#([\\w-]+)$/.exec(sel);
  if(idM){
    const id=idM[1];
    for(let i=0;i<C.length;i++){const c=C[i];if(c&&c.id===id)return c;}
  } else if(sel.indexOf('[name=')>=0){
    const m=/\[name=["']?([^"'\]]+)["']?\]/.exec(sel);
    if(m){const nm=m[1];for(let i=0;i<C.length;i++){const c=C[i];if(c&&c.name===nm)return c;}}
  }
  return null;
};
const __kdSelState=function(sel){return typeof sel==='string'?(__kdMirror.selectors[sel]||null):null;};
// setter 乐观回写:同一同步段内 set 后立刻 get 读到新值(与真 jQuery 一致)
const __kdPatch=function(sel,patch){
  if(typeof sel!=='string')return;
  const e=__kdMirror.selectors[sel]||(__kdMirror.selectors[sel]={});
  for(const k in patch)e[k]=patch[k];
  // 纯 #id 写操作:条目无 id 时从选择器补上,并进反向索引(attr('id') 回查链)
  const idM=/(?:^|\\s)#([\\w-]+)$/.exec(sel);
  if(!e.id&&idM)e.id=idM[1];
  __kdIndexState(e);
  const c=__kdFindControl(sel);
  if(c)for(const k in patch)c[k]=patch[k];
};
const __kdProbeQueue={};
const flush=async()=>{
  if(flushPromise)return flushPromise;
  flushPromise=(async()=>{
    while(ops.length){const batch=ops;ops=[];await sendBatch(batch);}
    while(jqReadyQueue.length){
      const q=jqReadyQueue.splice(0);
      // 逐个隔离:某个作者脚本的 $(()=>{…}) 初始化回调抛错不能连坐整批(实跑:悬浮球一条
      // TypeError 把卡里 12 个脚本一起判成「不兼容或执行失败」,沙箱连 done 都发不出去)。
      for(const fn of q){
        try{await Promise.resolve(fn());}
        catch(e){
          const __who=window.__kdScriptName?('[卡脚本 '+window.__kdScriptName+'] '):'';
          warn(__who+'初始化回调失败: '+(e&&(e.stack||e.message)||String(e)));
        }
      }
      while(ops.length){const batch=ops;ops=[];await sendBatch(batch);}
    }
  })().finally(()=>{flushPromise=null;});
  return flushPromise;
};
const enqueue=(op)=>{ops.push(op);queueMicrotask(()=>{void flush().catch(e=>warn('DOM 操作失败: '+(e&&e.message?e.message:e)));});};
const __kdRefKey=function(ref){return ref?(ref.kind==='selector'?ref.value:ref.kind==='selector-index'?ref.value+'@@'+ref.index:null):null;};
const probe=(ref)=>{const k=__kdRefKey(ref);if(k&&!__kdProbeQueue[k]){__kdProbeQueue[k]=1;enqueue({ref,method:'probe',args:[]});}};
// ---- document.getElementById 门面:沙箱是不透明来源,自身文档没有任何卡内元素,
//      作者脚本的裸 getElementById(...).value / .innerHTML / .style.display 全部落空
//      (实跑问题 7 R5:赛马娘卡首楼 select/input/按钮交互失效的第二道断点)。
//      宿主在 boot(initialMirror)与每次事件/批回包下发容器状态镜像——按 id 索引的
//      元素状态 + 全部表单控件;这里据此返回元素门面:读走镜像(同步真值,in 含 select
//      的 value/selectedIndex/options[i].text),写经既有 DOM 白名单 batch 回写宿主真实
//      元素(innerHTML/value/checked/disabled/style.*),并乐观补丁镜像保证同一同步段内
//      写后即读一致。未命中镜像时回退原生(沙箱空文档返回 null,交给作者代码的空值分支)。
const __kdReadElemState=function(id){
  const key='#'+id;
  return __kdMirror.selectors[key]||__kdById[id]||null;
};
const __kdElemFacade=function(entry){
  const id=String((entry&&entry.id)||'');
  const ref={kind:'selector',value:'#'+id};
  const read=function(){return __kdReadElemState(id)||entry||{};};
  const ctl=function(){const c=__kdFindControl('#'+id);return c||null;};
  const write=function(method,args,patch){if(id)enqueue({ref,method,args});if(id)__kdPatch(ref.value,patch);};
  const state=read();
  const fac={
    id:id,
    tagName:String(state.tag||'').toUpperCase(),
    getAttribute:function(k){const n=String(k);const s=read();
      if(n==='id')return id||null;
      if(n==='name')return typeof s.name==='string'?s.name:null;
      if(n==='value')return typeof s.val==='string'?s.val:null;
      if(n==='class')return Array.isArray(s.classes)?s.classes.join(' '):null;
      if(n.indexOf('data-')===0){const key=n.slice(5).replace(/-([a-z])/g,function(_,c){return c.toUpperCase();});return key in s?String(s[key]):null;}
      return null;},
    setAttribute:function(k,v){if(k==='value')write('val',[String(v??'')],{val:String(v??'')});},
    removeAttribute:function(){},
    hasAttribute:function(k){return String(k)==='id'?!!id:false;},
    classList:{
      contains:function(c){const s=read();return Array.isArray(s.classes)&&s.classes.indexOf(String(c))>=0;},
      add:function(){write('addClass',Array.prototype.slice.call(arguments),{});},
      remove:function(){write('removeClass',Array.prototype.slice.call(arguments),{});},
    },
    get className(){const s=read();return Array.isArray(s.classes)?s.classes.join(' '):'';},
    set className(v){write('attr',['class',String(v??'')],{});},
    dataset:Object.assign({},(entry&&entry.data)||{}),
    // 游离子树操作:本卡剪贴板兜底分支会 createElement + body.appendChild;
    // 沙箱不实现真子树,仅保证不抛错(主路径经 navigator.clipboard 桥,不走此处)。
    appendChild:function(c){return c;},
    removeChild:function(c){return c;},
    insertBefore:function(c){return c;},
    querySelector:function(){return null;},
    querySelectorAll:function(){return [];},
    getBoundingClientRect:function(){return {top:0,left:0,right:__kdGeo.width,bottom:__kdGeo.height,width:__kdGeo.width,height:__kdGeo.height,x:0,y:0};},
    // 有宿主 rect 快照就用真值(元素定位脚本按它算),否则退回落差(沙箱文档本身占满视口)
    closest:function(){return null;},
    remove:function(){},
    focus:function(){},
    blur:function(){},
    click:function(){if(id)enqueue({ref,method:'trigger',args:['click']});},
    contains:function(){return false;},
    get style(){return __kdElemStyleFacade(read,write);},
  };
  // 读属性:每次取镜像最新值(同一同步段内写后即读要走乐观补丁)
  for(const key of ['value','val']){
    Object.defineProperty(fac,key,{configurable:true,get:function(){const s=read();const c=ctl();if(c&&typeof c.val==='string')return c.val;return typeof s.val==='string'?s.val:'';},set:function(v){write('val',[String(v??'')],{val:String(v??'')});}});
  }
  Object.defineProperty(fac,'checked',{configurable:true,get:function(){const s=read();const c=ctl();return c?!!c.checked:!!s.checked;},set:function(v){write('prop',['checked',!!v],{checked:!!v});}});
  Object.defineProperty(fac,'disabled',{configurable:true,get:function(){const s=read();const c=ctl();return c?!!c.disabled:!!s.disabled;},set:function(v){write('prop',['disabled',!!v],{disabled:!!v});}});
  Object.defineProperty(fac,'selectedIndex',{configurable:true,get:function(){const c=ctl();const s=read();if(c&&typeof c.selectedIndex==='number')return c.selectedIndex;return typeof s.selectedIndex==='number'?s.selectedIndex:-1;}});
  Object.defineProperty(fac,'options',{configurable:true,get:function(){const c=ctl();const s=read();const src=c&&Array.isArray(c.options)?c.options:(Array.isArray(s.options)?s.options:[]);return src.map(function(o){return {value:String((o&&o.value)||''),text:String((o&&o.text)||'')};});}});
  Object.defineProperty(fac,'innerHTML',{configurable:true,get:function(){const s=read();return typeof s.html==='string'?s.html:'';},set:function(v){write('html',[String(v??'')],{html:String(v??'')});}});
  Object.defineProperty(fac,'outerHTML',{configurable:true,get:function(){const s=read();return typeof s.html==='string'?s.html:'';}});
  Object.defineProperty(fac,'textContent',{configurable:true,get:function(){const s=read();return typeof s.text==='string'?s.text:'';},set:function(v){write('text',[String(v??'')],{text:String(v??'')});}});
  Object.defineProperty(fac,'innerText',{configurable:true,get:function(){const s=read();return typeof s.text==='string'?s.text:'';},set:function(v){write('text',[String(v??'')],{text:String(v??'')});}});
  return fac;
};
const __kdElemStyleFacade=function(read,write){
  const cur=function(){const s=read();return (s&&s.css&&typeof s.css==='object')?s.css:{};};
  return new Proxy({},{
    get:function(_t,k){
      if(k==='setProperty')return function(prop,v){write('css',[String(prop),String(v)],{css:Object.assign({},cur(),{[String(prop)]:String(v)})});};
      if(k==='removeProperty')return function(prop){write('css',[String(prop),''],{css:Object.assign({},cur(),{[String(prop)]:''})});};
      if(k==='getPropertyValue')return function(prop){const c=cur();return c[String(prop)]||c[String(prop).replace(/-([a-z])/g,function(_m,ch){return ch.toUpperCase();})]||'';};
      if(k==='length')return 0;
      if(k==='item')return function(){return '';};
      const c=cur();return c[k]!==undefined?c[k]:'';
    },
    set:function(_t,k,v){
      if(k==='cssText'){return true;}
      write('css',[String(k),String(v)],{css:Object.assign({},cur(),{[String(k)]:String(v)})});
      return true;
    },
  });
};
// 覆写 document.getElementById:命中宿主镜像返回门面,未命中回退原生(空文档 null)。
// 只拦截 getElementById —— 本卡需求面;querySelector 等保持原生,最小化回归风险。
try{
  const __kdNativeGetById=document.getElementById.bind(document);
  Object.defineProperty(document,'getElementById',{configurable:true,writable:true,value:function(id){
    const key=String(id);
    const st=__kdReadElemState(key);
    const c=__kdFindControl('#'+key);
    if(!st&&!c)return __kdNativeGetById(key);
    return __kdElemFacade(c||st);
  }});
}catch(e){warn('document 查询门面安装失败(作者脚本裸 getElementById 将拿不到卡内元素): '+(e&&e.message?e.message:e));}
// $('<div …>') 创建游离元素:on 绑定与子元素先记在 spec 里,append 进真实容器时由宿主一并落 DOM
// ---- 游离元素桥:原生 createElement 造出来的节点宿主看不见 ----
// 作者脚本常见写法:document.createElement('button') 造节点、挂原生 addEventListener、
// 再 appendChild 进 jQuery 容器(露出日记-0615 的悬浮球「墨」球 + 拖拽全走这条)。
// 沙箱文档是空的不透明来源,所以:①createElement 时给元素挂钩子(监听登记 + style 门面);
// ②落 DOM 时序列化成 CreatedElementSpec(带 kdId,宿主落 DOM 时写 data-kd-el);
// ③落 DOM 之后再绑的监听/改的样式,按 kdId 转成 kdel 上的 on/css op 补发。`;
}
