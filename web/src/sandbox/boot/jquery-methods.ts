// jquery-methods.ts — jQuery 集合方法、选择器遍历与状态栏补丁（从 boot-script.ts 拆出）

export const JQUERY_METHODS_SCRIPT = `  // ---- 数字索引:jQuery 里 coll[0] 是真 DOM 节点 ----
  // 作者脚本拿它调原生 API:r[0].appendChild(a)(悬浮球把真实 button 塞进容器)、
  // s[0].style.left=... 拖拽定位。沙箱没有真节点,返回门面:读走 spec,
  // 写按 kdId 下发宿主真实元素(见 protocol.ts 的 kdel 引用)。
  const nodeFacade=function(){
    const styleProxy=new Proxy({},{get:function(_t,k){
      if(k==='setProperty')return function(p,v){spec.css[String(p)]=String(v);live('css',[String(p),String(v)]);};
      if(k==='removeProperty')return function(p){delete spec.css[String(p)];live('css',[String(p),'']);};
      if(k==='getPropertyValue')return function(p){return spec.css[String(p)]||'';};
      if(k==='cssText')return '';
      const cur=spec.css[k];return cur===undefined?'':cur;
    },set:function(_t,k,v){spec.css[String(k)]=String(v);live('css',[String(k),String(v)]);return true;}});
    const fac={};
    const attrOf=function(k){const v=spec.attrs[String(k)];return v===undefined?null:String(v);};
    fac.appendChild=function(child){
      if(!child)return child;
      if(child.__kdSpec){__kdAppendSpec(child.__kdSpec,coll);return child;}
      if(typeof child.outerHTML==='string'){
        const cs=__kdElemToSpec(child);
        const h=__kdHookOf(child);
        if(h)h.mounted=true;
        __kdAppendSpec(cs,coll);
        // 原生元素落 DOM 后,它的样式改写还要继续生效(拖拽改 left/top)
        if(h&&cs.kdId)
          for(const k in h.style)enqueue({ref:{kind:'kdel',id:cs.kdId},method:'css',args:[k,String(h.style[k])]});
        return child;
      }
      return child;
    };
    fac.append=function(child){return fac.appendChild(child);};
    fac.removeChild=function(child){live('remove',[]);return child;};
    fac.insertBefore=function(child){return fac.appendChild(child);};
    fac.setAttribute=function(k,v){spec.attrs[String(k)]=String(v);live('attr',[String(k),String(v)]);};
    fac.getAttribute=function(k){return attrOf(k);};
    fac.hasAttribute=function(k){return attrOf(k)!==null;};
    fac.removeAttribute=function(k){delete spec.attrs[String(k)];};
    fac.classList={
      add:function(){spec.addClass=(spec.addClass?spec.addClass+' ':'')+Array.prototype.slice.call(arguments).join(' ');live('addClass',[Array.prototype.slice.call(arguments).join(' ')]);},
      remove:function(){live('removeClass',[Array.prototype.slice.call(arguments).join(' ')]);},
      contains:function(){return false;},
      toggle:function(){},
    };
    fac.dataset={};
    // 宿主文档门面:作者脚本用 el.ownerDocument.defaultView 取窗口绑事件(拖拽收尾)、
    // 用 el.ownerDocument.createElement 继续建节点,原生值会落到沙箱自己的空文档。
    Object.defineProperty(fac,'ownerDocument',{configurable:true,get:function(){return __kdHostDocumentFacade;}});
    // 原生事件监听:作者脚本对 coll[0] 直接 addEventListener(悬浮球-0613 的拖拽全走这条,
    // 实跑报 Ee.addEventListener is not a function,把 12 个卡脚本一起拖垮)。
    // 未挂载 → 登记进 spec.handlers(落 DOM 时由宿主绑定);已挂载 → 按 kdId 发 on op。
    fac.addEventListener=function(evt,fn){
      if(typeof fn!=='function')return;
      const id=++jqIdSeq;
      jqHandlers.set(id,fn);
      const name=String(evt);
      if(spec.mounted&&spec.kdId)enqueue({ref:{kind:'kdel',id:spec.kdId},method:'on',args:[name,id,null]});
      else spec.handlers.push({evt:name,jqId:id});
    };
    fac.removeEventListener=function(evt,fn){
      for(let i=spec.handlers.length-1;i>=0;i--){if(spec.handlers[i].evt===String(evt)&&(!fn||jqHandlers.get(spec.handlers[i].jqId)===fn))spec.handlers.splice(i,1);}
      if(spec.mounted&&spec.kdId)enqueue({ref:{kind:'kdel',id:spec.kdId},method:'off',args:[String(evt)]});
    };
    fac.dispatchEvent=function(){return true;};
    fac.setPointerCapture=function(){};
    fac.releasePointerCapture=function(){};
    fac.matches=function(){return false;};
    fac.closest=function(){return null;};
    fac.querySelector=function(){return null;};
    fac.querySelectorAll=function(){return [];};
    fac.click=function(){live('trigger',['click']);};
    fac.focus=function(){live('focus',[]);};
    fac.remove=function(){live('remove',[]);};
    fac.getBoundingClientRect=function(){return {top:__kdGeo.top,left:__kdGeo.left,right:__kdGeo.left+__kdGeo.width,bottom:__kdGeo.top+__kdGeo.height,width:__kdGeo.width,height:__kdGeo.height,x:__kdGeo.left,y:__kdGeo.top};};
    // 已挂载就报宿主真值(拖拽抓取偏移/定位脚本按它算),未挂载才退回落差
    const __rect=function(){return __kdRectOf(spec.kdId);};
    fac.getBoundingClientRect=function(){return __rect();};
    fac.offsetWidth=0;fac.offsetHeight=0;fac.offsetLeft=0;fac.offsetTop=0;
    Object.defineProperty(fac,'offsetWidth',{configurable:true,get:function(){return __rect().width;}});
    Object.defineProperty(fac,'offsetHeight',{configurable:true,get:function(){return __rect().height;}});
    fac.offsetLeft=0;fac.offsetTop=0;
    fac.clientWidth=0;fac.clientHeight=0;fac.scrollWidth=0;fac.scrollHeight=0;fac.scrollTop=0;
    Object.defineProperty(fac,'style',{configurable:true,get:function(){return styleProxy;}});
    Object.defineProperty(fac,'id',{configurable:true,get:function(){return spec.attrs.id||'';},set:function(v){spec.attrs.id=String(v??'');live('attr',['id',String(v??'')]);}});
    Object.defineProperty(fac,'textContent',{configurable:true,get:function(){return spec.text||'';},set:function(v){spec.text=String(v??'');live('text',[String(v??'')]);}});
    Object.defineProperty(fac,'innerHTML',{configurable:true,get:function(){return spec.innerHtml||'';},set:function(v){spec.innerHtml=String(v??'');live('html',[String(v??'')]);}});
    Object.defineProperty(fac,'outerHTML',{configurable:true,get:function(){return spec.html||'';}});
    return fac;
  };
  for(let __ci=0;__ci<4;__ci++)(function(idx){Object.defineProperty(coll,idx,{configurable:true,get:function(){return idx===0?nodeFacade():undefined;}});})(__ci);
  return coll;
}
function jq(sel){
  if(typeof sel==='function'){jqReadyQueue.push(sel);return;}
  if(typeof sel==='string'&&/^\\s*</.test(sel))return jqCreated({kind:'created',html:sel,handlers:[],children:[]});
  if(sel&&sel.kind==='created')return jqCreated(sel);
  const ref=typeof sel==='string'?{kind:'selector',value:sel}
    // $(document)/$(window):作者脚本以窗口为事件源($(window).on('unload', …));
    // 放在 target/selector-index 判定之前(这两个是沙箱内真实对象,非引用句柄)。
    // typeof 守卫:部分 vm 测试 harness 未提供 document 全局,直接引用会抛 ReferenceError。
    :typeof document!=='undefined'&&sel===document?{kind:'document'}
    :typeof window!=='undefined'&&sel===window?{kind:'window'}
    :sel&&sel.kind==='target'?{kind:'target',id:sel.id}
    :sel&&sel.kind==='selector-index'?{kind:'selector-index',value:sel.value,index:sel.index}
    // 已落 DOM 的游离元素句柄(created 集合挂载后返回)
    :sel&&sel.kind==='kdel'?{kind:'kdel',id:sel.id}
    :null;
  const isSnap=!!(sel&&sel.kind==='snapshot');
  const localData=sel&&(sel.kind==='target'||isSnap)&&sel.data?sel.data:{};
  const localState=sel&&sel.kind==='target'&&sel.state?sel.state:(isSnap?sel.data:null);
  const refKey=__kdRefKey(ref);
  const readState=function(){return localState||(refKey?__kdMirror.selectors[refKey]||null:null);};
  const coll={};
  // 供 $('<div>').appendTo($(target)) 这类「目标也是集合」的挂载路径取引用
  Object.defineProperty(coll,'__kdRefGet',{get:function(){return function(){return ref;};}});
  coll.text=function(v){if(arguments.length===0){const st=readState();if(!st)probe(ref);return st&&typeof st.text==='string'?st.text:'';}if(ref)enqueue({ref,method:'text',args:[v]});__kdPatch(sel,{text:String(v??'')});return coll;};
  coll.html=function(v){if(arguments.length===0){const st=readState();if(!st)probe(ref);return st&&typeof st.html==='string'?st.html:'';}if(ref)enqueue({ref,method:'html',args:[v]});__kdPatch(sel,{html:String(v??'')});return coll;};
  // css 四种形态:0 参返回 '';1 参字符串 getter(从镜像读真值,无镜像 probe 后返回 '');
  // 1 参对象逐键 setter;2 参 setter(现行为)。对象形式此前被当 getter 吞掉,
  // 悬浮球 .css({position:'fixed',zIndex:9999,…}) 全部丢失 → 无定位无层叠。
  coll.css=function(p,v){
    if(arguments.length===0)return '';
    if(arguments.length===1){
      if(p&&typeof p==='object'){
        for(const k in p){if(ref)enqueue({ref,method:'css',args:[k,p[k]]});}
        __kdPatch(sel,{css:Object.assign({},(readState()||{}).css||{},p)});
        return coll;
      }
      const st=readState();
      if(!st){probe(ref);return '';}
      const cs=st.css&&typeof st.css==='object'?st.css:null;
      return cs&&typeof cs[p]==='string'?cs[p]:(typeof st.style==='object'&&st.style&&typeof st.style[p]==='string'?st.style[p]:'');
    }
    if(ref)enqueue({ref,method:'css',args:[p,v]});
    __kdPatch(sel,{css:Object.assign({},(readState()||{}).css||{},{[String(p)]:String(v??'')})});
    return coll;
  };
  coll.addClass=function(c){if(ref)enqueue({ref,method:'addClass',args:[c]});const st=readState();const cl=st&&Array.isArray(st.classes)?st.classes.slice():[];for(const x of String(c??'').split(/\\s+/).filter(Boolean))if(cl.indexOf(x)<0)cl.push(x);__kdPatch(sel,{classes:cl});return coll;};
  coll.removeClass=function(c){if(ref)enqueue({ref,method:'removeClass',args:[c]});const st=readState();const rm=String(c??'').split(/\\s+/).filter(Boolean);const cl=(st&&Array.isArray(st.classes)?st.classes:[]).filter(x=>rm.indexOf(x)<0);__kdPatch(sel,{classes:cl});return coll;};
  coll.hasClass=function(name){const st=readState();if(!st)probe(ref);const cl=st&&Array.isArray(st.classes)?st.classes:[];return cl.indexOf(String(name))>=0;};
  // 集合筛选类 API:沙箱里没有真实 DOM 集合(只有选择器句柄),无法真正筛选。
  // 这里保持链式语义(返回自身)而不是缺方法抛 TypeError——作者脚本常见写法
  // $('.hang').filter('.pick').addClass('on') 在兼容执行器里曾整段失败
  // (B1 批实跑:露出日记-0615 的 $(...).filter is not a function)。
  coll.filter=function(){return coll;};
  coll.not=function(){return coll;};
  coll.first=function(){return coll;};
  coll.last=function(){return coll;};
  coll.eq=function(){return coll;};
  coll.slice=function(){return coll;};
  coll.map=function(cb){const out=[];if(typeof cb==='function'){try{cb.call(null,0,null);}catch(e){/* 回调依赖真实元素:忽略 */}}return jq(out);};
  coll.toArray=function(){return [];};
  coll.get=function(){return undefined;};
  coll.is=function(){return false;};
  coll.index=function(){return -1;};
  coll.closest=function(){return coll;};
  coll.find=function(subSel){
    if(typeof subSel!=='string'||!subSel.trim())return jq([]);
    const q=subSel.trim();
    if(ref&&ref.kind==='selector')return jq(ref.value+' '+q);
    if(ref&&ref.kind==='kdel')return jq('[data-kd-el="'+ref.id+'"] '+q);
    return jq(q);
  };
  coll.children=function(){return coll;};
  coll.parent=function(){return coll;};
  coll.siblings=function(){return coll;};
  // data:ui-draggable 反映本集合是否已应用过 draggable(销毁钩子据此决定是否 destroy);
  // 其余键沿用事件 target.data / 本地数据
  coll.data=function(name){const n=String(name);if(n==='ui-draggable')return !!(refKey&&jqDraggableApplied[refKey]);return localData[n]??'';};
  coll.val=function(v){if(arguments.length===0){const c=__kdFindControl(sel);if(c&&typeof c.val==='string')return c.val;const st=readState();if(st&&typeof st.val==='string')return st.val;if(!st)probe(ref);return '';}if(ref)enqueue({ref,method:'val',args:[v]});__kdPatch(sel,{val:String(v??'')});return coll;};
  coll.on=function(evt,fn){const p=__kdParseOn.apply(null,arguments);if(ref&&p){const id=++jqIdSeq;jqHandlers.set(id,p.fn);enqueue({ref,method:'on',args:[p.evt,id,p.selector]});}return coll;};
  coll.off=function(evt){if(ref)enqueue({ref,method:'off',args:[evt]});return coll;};
  coll.hide=function(){if(ref)enqueue({ref,method:'css',args:['display','none']});__kdPatch(sel,{css:Object.assign({},(readState()||{}).css||{},{display:'none'})});__kdAnimRun(coll,arguments);return coll;};
  coll.show=function(){if(ref)enqueue({ref,method:'css',args:['display','']});__kdPatch(sel,{css:Object.assign({},(readState()||{}).css||{},{display:''})});__kdAnimRun(coll,arguments);return coll;};
  // toggle:boolean 参走 show/hide,无参按 css display 现状翻转(镜像读当前值)
  coll.toggle=function(show){if(typeof show==='boolean')return show?coll.show():coll.hide();const cur=coll.css('display');const r=cur==='none'?coll.show():coll.hide();__kdAnimRun(coll,arguments);return r;};
  // animate:仅 scrollTop/scrollLeft 有等价操作(直接置位,无动画);其余属性 no-op 返回 coll
  coll.animate=function(props,ms,cb){if(props&&typeof props==='object'){for(const k in props){if(k==='scrollTop'||k==='scrollLeft'){if(ref)enqueue({ref,method:'css',args:[k,props[k]]});}}}if(typeof ms==='function')Promise.resolve().then(function(){ms();});else if(typeof cb==='function')Promise.resolve().then(function(){cb();});return coll;};
  // 开场界面脚本依赖的动画/属性方法:映射为等价操作(无动画,同步语义与 jQuery 一致)
  coll.slideDown=function(){if(ref)enqueue({ref,method:'css',args:['display','']});__kdAnimRun(coll,arguments);return coll;};
  coll.slideUp=function(){if(ref)enqueue({ref,method:'css',args:['display','none']});__kdAnimRun(coll,arguments);return coll;};
  coll.fadeIn=function(){if(ref)enqueue({ref,method:'css',args:['display','']});__kdAnimRun(coll,arguments);return coll;};
  coll.fadeOut=function(){if(ref)enqueue({ref,method:'css',args:['display','none']});__kdAnimRun(coll,arguments);return coll;};
  coll.prop=function(name,value){if(arguments.length===1){const c=__kdFindControl(sel);const st=readState();if(!c&&!st)probe(ref);if(name==='checked')return c?!!c.checked:st?!!st.checked:false;if(name==='disabled')return c?!!c.disabled:st?!!st.disabled:false;if(name==='value')return c&&typeof c.val==='string'?c.val:st&&typeof st.val==='string'?st.val:'';return false;}if(ref)enqueue({ref,method:'prop',args:[name,value]});if(name==='checked')__kdPatch(sel,{checked:!!value});else if(name==='disabled')__kdPatch(sel,{disabled:!!value});else if(name==='value')__kdPatch(sel,{val:String(value??'')});return coll;};
  coll.attr=function(name,value){
    if(arguments.length===1){
      // 1 参对象:逐键 setter(attr({id:'x',class:'y'}))
      if(name&&typeof name==='object'){
        for(const k in name){if(ref)enqueue({ref,method:'attr',args:[k,name[k]]});}
        const patch={};for(const k in name){if(k==='id')patch.id=String(name[k]);else if(k==='class')patch.classes=String(name[k]).split(/\\s+/).filter(Boolean);}
        if(Object.keys(patch).length)__kdPatch(sel,patch);
        return coll;
      }
      const st=readState();
      if(name==='id'){
        if(st&&typeof st.id==='string'&&st.id)return st.id;
        // 镜像无此选择器:复合类选择器走反向索引回查(jQuery 语义=集合首元素 id)
        const hit=typeof sel==='string'?__kdByClassLookup(sel):null;
        if(hit)return hit;
        if(!st)probe(ref);
        return '';
      }
      const nStr=String(name);
      if(nStr==='class')return st&&Array.isArray(st.classes)?st.classes.join(' '):'';
      if(nStr==='value'||nStr==='val'){
        const c=__kdFindControl(sel);
        if(c&&typeof c.val==='string')return c.val;
        return st&&typeof st.val==='string'?st.val:'';
      }
      if(nStr.indexOf('data-')===0){
        const dataKey=nStr.slice(5).replace(/-([a-z])/g,function(_,c){return c.toUpperCase();});
        if(localData&&dataKey in localData)return String(localData[dataKey]);
        if(st&&st.dataset&&typeof st.dataset==='object'&&dataKey in st.dataset)return String(st.dataset[dataKey]);
      }
      if(!st)probe(ref);
      return '';
    }
    if(ref)enqueue({ref,method:'attr',args:[name,value]});
    if(name==='id')__kdPatch(sel,{id:String(value??'')});
    return coll;
  };
  coll.trigger=function(evt){if(ref)enqueue({ref,method:'trigger',args:[evt]});return coll;};
  // append 支持 $('<div>') 游离元素(spec 经 appendCreated 由宿主落 DOM 并绑定延迟事件)
  coll.append=function(html){if(html&&html.__kdSpec){if(ref)enqueue({ref,method:'appendCreated',args:[html.__kdSpec]});return coll;}if(ref)enqueue({ref,method:'append',args:[String(html??'')]});return coll;};
  // 与游离元素集合对齐的链式 API(作者脚本会混用两类集合;缺方法会 TypeError 整段失效)
  coll.prepend=function(html){return coll.append(html);};
  coll.appendTo=function(){return coll;};
  coll.prependTo=function(){return coll;};
  coll.insertBefore=function(){return coll;};
  coll.insertAfter=function(){return coll;};
  coll.before=function(html){return coll.append(html);};
  coll.after=function(html){return coll.append(html);};
  coll.replaceAll=function(){return coll;};
  coll.add=function(){return coll;};
  coll.has=function(){return coll;};
  coll.next=function(){return coll;};
  coll.clone=function(){return coll;};
  coll.serialize=function(){return '';};
  coll.stop=function(){return coll;};
  coll.focus=function(){if(ref)enqueue({ref,method:'focus',args:[]});return coll;};
  coll.is=function(q){const c=__kdFindControl(sel);const st=readState();if(!c&&!st)probe(ref);if(q===':checked')return c?!!c.checked:st?!!st.checked:false;if(q===':disabled')return c?!!c.disabled:st?!!st.disabled:false;
    // :visible/:hidden 从镜像 css.display 判定(wuwa 面板 $panel.is(':hidden') 决定展开);
    // 镜像无 display 信息时按合理默认(:visible=false / :hidden=true),不抛错
    if(q===':visible'||q===':hidden'){const cs=st&&st.css&&typeof st.css==='object'?st.css:null;const disp=cs&&typeof cs.display==='string'?cs.display:null;const hidden=disp===null?true:disp==='none';return q===':visible'?!hidden:hidden;}
    return false;};
  coll.outerHeight=function(){const st=readState();if(st&&typeof st.offsetHeight==='number')return st.offsetHeight;if(!st)probe(ref);return 0;};
  coll.closest=function(){return coll;};
  coll.remove=function(){if(ref)enqueue({ref,method:'remove',args:[]});return coll;};
  coll.empty=function(){if(ref)enqueue({ref,method:'empty',args:[]});return coll;};
  // ---- wuwa 状态栏实测缺口:toggleClass/first/last/eq/click/each/length/索引访问 ----
  coll.toggleClass=function(c,force){if(ref)enqueue({ref,method:'toggleClass',args:[String(c??''),force]});const st=readState();const cl=st&&Array.isArray(st.classes)?st.classes.slice():[];for(const x of String(c??'').split(/\\s+/).filter(Boolean)){const i=cl.indexOf(x);const want=typeof force==='boolean'?!!force:i<0;if(want&&i<0)cl.push(x);else if(!want&&i>=0)cl.splice(i,1);}if(typeof sel==='string')__kdPatch(sel,{classes:cl});return coll;};
  coll.first=function(){return jq(ref&&ref.kind==='selector'?{kind:'selector-index',value:ref.value,index:0}:ref?ref:sel);};
  coll.last=function(){return jq(ref&&ref.kind==='selector'?{kind:'selector-index',value:ref.value,index:-1}:ref?ref:sel);};
  coll.eq=function(i){const n=Number(i)||0;return jq(ref&&ref.kind==='selector'?{kind:'selector-index',value:ref.value,index:n}:ref?ref:sel);};
  coll.click=function(fn){if(typeof fn==='function')return coll.on('click',fn);if(ref)enqueue({ref,method:'trigger',args:['click']});return coll;};
  // each:从镜像 items 同步迭代(元素状态随批处理回包与事件回包到达;未命中时 probe 补采)
  coll.each=function(cb){if(typeof cb!=='function')return coll;const st=readState();const items=st&&Array.isArray(st.items)?st.items:null;
    if(items){for(let i=0;i<items.length;i++){const snap={kind:'snapshot',data:items[i]};if(cb.call(snap,i,snap)===false)break;}}
    else if(ref)probe(ref);
    return coll;};
  // jQuery .length 是属性:集合大小从镜像读(getter 语义与真 jQuery 一致,无镜像时 probe 后先回 0)
  Object.defineProperty(coll,'length',{get:function(){const st=readState();if(st&&typeof st.n==='number')return st.n;if(localState)return 1;if(ref)probe(ref);return 0;}});
  // 数字索引访问($('.nav-btn').first()[0] 等):返回可再被 $() 包装的 selector-index 引用,
  // 并带上镜像里的直读属性($card[0].scrollTop/scrollHeight/clientHeight/checked/value 等——
  // 协议卡 checkBottom 就靠这些度量判断滚动到底)。未命中时 probe 补采,下个事件 tick 可读。
  for(let __i=0;__i<4;__i++)(function(idx){Object.defineProperty(coll,idx,{get:function(){
    let r;
    if(ref&&ref.kind==='selector')r={kind:'selector-index',value:ref.value,index:idx};
    else if(ref&&ref.kind==='selector-index')r={kind:'selector-index',value:ref.value,index:ref.index+idx};
    else if(localState)return idx===0?sel:undefined;
    else return undefined;
    const st=__kdMirror.selectors[r.value+'@@'+r.index]||(r.index===0?__kdMirror.selectors[r.value]:null);
    if(st){
      const gk=['scrollTop','scrollLeft','scrollHeight','scrollWidth','clientHeight','clientWidth','offsetHeight','offsetWidth'];
      for(const k of gk){if(typeof st[k]==='number')r[k]=st[k];}
      if(typeof st.val==='string')r.value=st.val;
      if('checked' in st)r.checked=!!st.checked;
      if('disabled' in st)r.disabled=!!st.disabled;
      if(st.id)r.id=st.id;
      if(typeof st.text==='string')r.textContent=st.text;
    } else probe(r);
    // 原生节点门面:作者脚本拿 coll[0] 当 DOM 用(s[0].style.left 定位、
    // r[0].appendChild(真实节点) 挂子元素),这里把读写映射回 kdel/selector-index 引用
    try{
      Object.defineProperty(r,'style',{configurable:true,get:function(){
        return new Proxy({},{get:function(_t,k){
          if(k==='setProperty')return function(p,v){enqueue({ref:r,method:'css',args:[String(p),String(v)]});};
          if(k==='getPropertyValue')return function(p){const cs=st&&st.css?st.css[String(p)]:undefined;return cs===undefined?'':cs;};
          if(k==='cssText')return '';
          const cs=st&&st.css?st.css[k]:undefined;
          return cs===undefined?'':cs;
        },set:function(_t,k,v){enqueue({ref:r,method:'css',args:[String(k),String(v)]});return true;}});
      }});
    }catch(_e){}
    try{
      Object.defineProperty(r,'appendChild',{configurable:true,get:function(){
        return function(child){
          if(!child)return child;
          if(child.__kdSpec){enqueue({ref:r,method:'appendCreated',args:[child.__kdSpec]});return child;}
          if(typeof child.outerHTML==='string'){
            const cs=__kdElemToSpec(child);
            const h=__kdHookOf(child);
            if(h)h.mounted=true;
            enqueue({ref:r,method:'appendCreated',args:[cs]});
            if(h)for(const k in h.style)enqueue({ref:{kind:'kdel',id:cs.kdId},method:'css',args:[k,String(h.style[k])]});
            return child;
          }
          return child;
        };
      }});
    }catch(_e){}
    return r;
  }});})(__i);
  // draggable:字符串 'destroy' 解绑;对象把 start/drag/stop 换成 jqId,其余可序列化字段原样
  // 入队。宿主在 pointermove/up 时以 jq-event 回发 event.ui.position(沙箱回调读它)。
  coll.draggable=function(opts){
    if(typeof opts==='string'){
      if(ref&&opts==='destroy'){enqueue({ref,method:'draggable',args:['destroy']});if(refKey)delete jqDraggableApplied[refKey];}
      return coll;
    }
    const o=opts&&typeof opts==='object'?opts:{};
    const wire={};
    for(const k of ['start','drag','stop']){if(typeof o[k]==='function'){const id=++jqIdSeq;jqHandlers.set(id,o[k]);wire[k]=id;}else wire[k]=0;}
    for(const k of ['handle','cancel','containment','cursor']){if(typeof o[k]==='string')wire[k]=o[k];}
    if(typeof o.distance==='number')wire.distance=o.distance;
    if(ref){enqueue({ref,method:'draggable',args:[wire]});if(refKey)jqDraggableApplied[refKey]=1;}
    return coll;
  };
  return coll;
}
const $=jq;`;
