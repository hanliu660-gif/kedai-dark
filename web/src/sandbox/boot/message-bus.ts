// message-bus.ts — 沙箱基础通信与事件派发（从 boot-script.ts 拆出）

export const MESSAGE_BUS_SCRIPT = `let seq=0;
const pending=new Map();
// 通信锚定真实父窗口:下文会给 window.parent 装门面(供作者脚本读取),send 不能绕经门面
const __kdSendTarget=parent;
const send=(type, extra={})=>__kdSendTarget.postMessage({channel:CHANNEL,nonce:NONCE,type,...extra}, '*');
const rpc=(op,...args)=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});send('rpc',{id,op,args});});
const sendBatch=(ops)=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});send('batch',{id,ops});});
addEventListener('message',(event)=>{
  const m=event.data;
  if(!m||m.channel!==CHANNEL||m.nonce!==NONCE)return;
  if(m.type==='rpc-result'){
    __kdMergeMirror(m.mirror);
    const p=pending.get(m.id);if(!p)return;pending.delete(m.id);
    m.ok?p.resolve(m.value):p.reject(new Error(String(m.error||'RPC 失败')));
  } else if(m.type==='geometry'){
    // 宿主容器几何镜像推送(聊天滚动/宿主窗口 resize 时节流推送)
    __kdSetGeo(m.geo);
  } else if(m.type==='jq-event'){
    __kdMergeMirror(m.mirror);
    __kdMergeEventTarget(m.target);
    // 同步派发(不用 rAF:隐藏沙箱里 rAF 永不回调,会把事件永久积压 —— 见文件内说明)。
    // 事件回调异常仅告警不拆沙箱:作者脚本单次点击报错(如跨域访问 window.parent.document)
    // 不应导致整个状态栏被 cleanup 拆除(此前此处上送 error 会触发宿主 finish→界面死亡)。
    const fn=jqHandlers.get(m.jqId);
    if(fn){
      // 事件体补 target/currentTarget:作者回调普遍写 e.target.closest(...) / e.target.dataset,
      // 只带坐标的事件体会在这一步抛 TypeError(此后被 warn 吞掉,表现为「点了没反应」)。
      const __tt=__kdWrapTarget(m.target);
      const __ev=Object.assign({target:__tt,currentTarget:__tt},m.event||{});
      try{
        Promise.resolve(fn.call(__tt,__ev)).then(flush).catch(function(e){
          send('warn',{message:'事件回调出错: '+(e&&e.message?e.message:e)});
        });
      }catch(e){
        send('warn',{message:'事件回调出错: '+(e&&e.message?e.message:e)});
      }
    }
  } else if(m.type==='script-button-click'){
    // 宿主按钮栏点击 → 按酒馆语义以 getButtonEvent(name) 事件名广播给作者脚本
    try{
      Promise.resolve(eventEmit(globalThis.getButtonEvent(String(m.name||'')),{})).catch(function(){});
    }catch(e){
      send('warn',{message:'脚本按钮广播失败: '+(e&&e.message?e.message:e)});
    }
  } else if(m.type==='inline-event'){
    // inline 事件降级桥:宿主把元素 data-kd-on* 属性里的作者代码串转回沙箱求值。
    // 优先走 __kdEvalInline(消息级单段由 IIFE 内注册,直接 eval——作用域链含作者脚本的
    // function 声明与 const 绑定;否则 onclick="submitCreation()" 这类调用在全局域
    // ReferenceError,这正是赛马娘卡首楼输入框/弹窗/复制按钮全部失效的主因)。
    // 无该桥(卡级 realm:作者脚本按 <script> 注入即全局作用域)时回退 new Function。
    __kdMergeMirror(m.mirror);
    __kdMergeEventTarget(m.target);
    try{
      const wrapped=__kdWrapTarget(m.target);
      const ev=Object.assign({preventDefault:function(){},stopPropagation:function(){},target:wrapped},m.event||{});
      const bridge=globalThis.__kdEvalInline;
      let run;
      if(typeof bridge==='function'){
        run=()=>bridge.call(wrapped,String(m.code||''),ev);
      }else{
        // 无闭包桥(卡级 realm:作者脚本即全局作用域)时回退 new Function;
        // 构造保持同步,语法错误仍走「解析失败」告警分支(与旧行为一致)
        const handler=new Function('event',String(m.code||''));
        run=()=>handler.call(wrapped,ev);
      }
      Promise.resolve().then(run).then(flush).catch(e=>send('warn',{message:'内联事件回调出错: '+(e&&e.message?e.message:e)}));
    }catch(e){send('warn',{message:'内联事件代码解析失败: '+(e&&e.message?e.message:e)});}
  } else if(m.type==='mvu-event'){
    // 宿主变量广播:合并最新变量树并触发本地事件订阅(状态栏的 MVU 更新监听)。
    // 广播可能在 boot 脚本求值前到达(ready 后宿主即注册 liveSandboxes),故整体容错。
    try{
      if(m.variables&&typeof m.variables==='object'){
        variables.stat_data=m.variables.stat_data&&typeof m.variables.stat_data==='object'?m.variables.stat_data:{};
        variables.display_data=m.variables.display_data&&typeof m.variables.display_data==='object'?m.variables.display_data:variables.stat_data;
      }
      __kdFireEvent(m.event,m.payload);
    }catch(_e){/* boot 前到达的广播丢弃 */}
  } else if(m.type==='card-event'){
    // 宿主卡级事件广播(swipe 切换等):直接派发到事件总线,供 eventOn 订阅
    // (舰娘卡「swipe 切换自动开关世界书」脚本监听 tavern_events.MESSAGE_SWIPED)
    try{__kdFireEvent(m.name,m.payload);}catch(_e){/* boot 前到达的广播丢弃 */}
  } else if(m.type==='shared-update'){
    // 宿主共享全局广播(同角色其余沙箱 publish 的全量快照):合法键赋到 window
    // 并并入基线防回声(自己注入的键不再 diff 上报回去)
    try{__kdSharedApply(m.globals);}catch(_e){/* boot 前到达的广播丢弃(TDZ) */}
  }
});
const warn=(m)=>send('warn',{message:String(m)});
// 事件 this 门面(jq-event 与 inline-event 共用):保留 kind/id/data/state 供 $() 再包装,
// 同时补齐 DOM 常用直读属性——作者代码里的 this.classList.contains('ready')/this.value/
// this.checked/this.dataset 等不再拿到 undefined。
const __kdWrapTarget=(t)=>{
  const base=t&&typeof t==='object'?t:{};
  const st=base.state&&typeof base.state==='object'?base.state:{};
  const classes=Array.isArray(st.classes)?st.classes:[];
  const data=base.data&&typeof base.data==='object'?base.data:{};
  return Object.assign({},base,{
    value:typeof st.val==='string'?st.val:'',
    checked:!!st.checked,
    disabled:!!st.disabled,
    dataset:data,
    classList:{contains:function(c){return classes.indexOf(String(c))>=0;}},
    textContent:typeof st.text==='string'?st.text:'',
    scrollTop:typeof st.scrollTop==='number'?st.scrollTop:0,
    scrollLeft:typeof st.scrollLeft==='number'?st.scrollLeft:0,
    scrollHeight:typeof st.scrollHeight==='number'?st.scrollHeight:0,
    scrollWidth:typeof st.scrollWidth==='number'?st.scrollWidth:0,
    clientHeight:typeof st.clientHeight==='number'?st.clientHeight:0,
    clientWidth:typeof st.clientWidth==='number'?st.clientWidth:0,
    offsetHeight:typeof st.offsetHeight==='number'?st.offsetHeight:0,
    offsetWidth:typeof st.offsetWidth==='number'?st.offsetWidth:0,
    getAttribute:function(k){const n=String(k);
      if(n==='id')return typeof st.id==='string'?st.id:null;
      if(n==='name')return typeof st.name==='string'?st.name:null;
      if(n==='value')return typeof st.val==='string'?st.val:null;
      if(n.indexOf('data-')===0){const key=n.slice(5).replace(/-([a-z])/g,function(_,c){return c.toUpperCase();});return key in data?String(data[key]):null;}
      return null;},
    // 原生监听回调里 e.target.closest('button') 是卡脚本的常见写法(悬浮球靠它区分
    // 「按在球上还是在球内按钮上」)。事件体只带坐标时 e.target 为 undefined,作者回调
    // 立刻抛 Cannot read properties of undefined (reading closest)。这里给最小匹配器:
    // 支持 tag / .class / #id 及其逗号组合,命中返回目标门面自身,否则 null。
    tagName:typeof st.tag==='string'?st.tag.toUpperCase():'',
    matches:function(sel){
      const list=String(sel||'').split(',').map(function(x){return x.trim();}).filter(Boolean);
      const tag=typeof st.tag==='string'?st.tag.toLowerCase():'';
      const id=typeof st.id==='string'?st.id:'';
      for(const one of list){
        if(one.charAt(0)==='.'){if(classes.indexOf(one.slice(1))>=0)return true;continue;}
        if(one.charAt(0)==='#'){if(id===one.slice(1))return true;continue;}
        if(tag&&one.toLowerCase()===tag)return true;
      }
      return false;
    },
    closest:function(sel){return this.matches(sel)?this:null;},
  });
};`;
