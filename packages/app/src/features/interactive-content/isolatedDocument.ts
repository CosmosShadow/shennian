// @arch docs/architecture/interactive-web-content.md
// @test src/__tests__/interactive-content-session.test.ts
const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  .replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** The child has scripts, but no host origin, cookies, native RPC or unrestricted network. */
export function buildIsolatedDocument(html: string, resourceOrigins: string[], bridge = false, safeArea = { top: 110, bottom: 135 }): string {
  const origins = [...new Set(resourceOrigins.map((value) => {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('invalid_resource_origin')
    return url.origin
  }))]
  const policy = `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: ${origins.join(' ')}; media-src ${origins.length ? origins.join(' ') : "'none'"}; font-src 'none'; connect-src ${origins.length ? origins.map((origin) => origin + '/api/interactive-content/assets/').join(' ') : "'none'"}; frame-src about:; object-src 'none'; base-uri 'none'; form-action 'none'`
  const top = Math.max(0, Math.min(300, Math.round(safeArea.top) || 0)), bottom = Math.max(0, Math.min(300, Math.round(safeArea.bottom) || 0))
  const childBridge = `<style data-shennian-host>:root{--shennian-safe-top:${top}px!important;--shennian-safe-bottom:${bottom}px!important}</style>${bridge ? `<script data-shennian-host>
(function(){
var auth='',permitted=false,methods=Object.create(null),methodsFrozen=false,nativePromise=Promise,keys=Object.keys,values=Object.values,nativeMap=Array.prototype.map,freeze=Object.freeze,parse=JSON.parse,stringify=JSON.stringify,send=parent.postMessage.bind(parent),stop=Event.prototype.stopImmediatePropagation,apply=Reflect.apply,define=Object.defineProperty,
dataGetter=Object.getOwnPropertyDescriptor(MessageEvent.prototype,'data').get,
sourceGetter=Object.getOwnPropertyDescriptor(MessageEvent.prototype,'source').get,
schedule=window.setTimeout.bind(window);
window.addEventListener('message',function(e){
 var data=apply(dataGetter,e,[]);
 if(!e.isTrusted||apply(sourceGetter,e,[])!==parent||!data||!['shennian.init','shennian.observe','shennian.invoke'].includes(data.type))return;
 apply(stop,e,[]);
 if(data.type==='shennian.init'){auth=typeof data.auth==='string'?data.auth:'';return;}
 if(data.auth!==auth)return;
 if(data.type==='shennian.invoke'){
  var method=methods[data.name];
  if(!method){send({type:'shennian.invoked',auth:auth,requestId:data.requestId,ok:false},'*');return;}
  nativePromise.resolve().then(function(){return method.handler(data.args);}).then(function(){send({type:'shennian.invoked',auth:auth,requestId:data.requestId,ok:true},'*');},function(){send({type:'shennian.invoked',auth:auth,requestId:data.requestId,ok:false},'*');});return;
 }
 if(data.type==='shennian.observe'){
  if(data.part==='methods'){methodsFrozen=true;freeze(methods);send({type:'shennian.observation',auth:auth,requestId:data.requestId,observation:{text:'',controls:[],methods:apply(nativeMap,values(methods),[function(m){return m.definition;}])}},'*');return;}
  var controls=Array.from(document.querySelectorAll('input,textarea,select')).filter(function(el){return !['password','hidden','file'].includes(el.type)&&!/(?:password|cc-|one-time-code)/i.test(el.autocomplete||'')&&el.getClientRects().length;}).slice(0,20).map(function(el){return {name:String(el.getAttribute('aria-label')||el.name||el.id||'').slice(0,100),type:String(el.type||el.tagName).slice(0,30),value:String(['checkbox','radio'].includes(el.type)?el.checked:el.value).slice(0,200)};});
  send({type:'shennian.observation',auth:auth,requestId:data.requestId,observation:{text:String(document.body.innerText||'').slice(0,6000),controls:controls}},'*');
 }
},true);
document.addEventListener('click',function(e){if(e.isTrusted){permitted=true;schedule(function(){permitted=false;},0);}},true);
function deepFreeze(value){if(value&&typeof value==='object'){apply(nativeMap,values(value),[deepFreeze]);freeze(value);}return value;}
function emit(data){if(!auth||!permitted)return;permitted=false;define(data,'auth',{value:auth,enumerable:true});send(data,'*');}
Object.defineProperty(window,'shennian',{configurable:false,writable:false,value:Object.freeze({
registerMethod:function(definition,handler){
 if(methodsFrozen||!definition||typeof definition.name!=='string'||!/^[a-z][a-z0-9_.-]{0,63}$/i.test(definition.name)||typeof handler!=='function'||keys(methods).length>=6)return false;
 try{var def={name:definition.name,description:String(definition.description||'').slice(0,200),parameters:parse(stringify(definition.parameters||{type:'object',properties:{},additionalProperties:false}))};if(stringify(def.parameters).length>1000)return false;deepFreeze(def);methods[def.name]=freeze({definition:def,handler:handler});return true;}catch(e){return false;}
},
request:function(text){if(typeof text==='string'&&text.length<=8000)emit({type:'shennian.intent',text:text});},
save:function(html,metadata){
 if(typeof html!=='string'){
  var copy=document.documentElement.cloneNode(true);
  copy.querySelectorAll('[data-shennian-host]').forEach(function(e){e.remove();});
  var live=document.querySelectorAll('input,textarea,select'),cloned=copy.querySelectorAll('input,textarea,select');
  live.forEach(function(e,i){var c=cloned[i];if(!c)return;if(e.type==='password'){c.removeAttribute('value');return;}if(e.tagName==='TEXTAREA')c.textContent=e.value;else if(e.tagName==='SELECT'){Array.from(c.options).forEach(function(o,j){o.toggleAttribute('selected',e.options[j].selected);});}else{c.setAttribute('value',e.value);c.toggleAttribute('checked',e.checked);}});
  html='<!doctype html>'+copy.outerHTML;
 }
 if(html.length<=120000)emit({type:'shennian.save',html:html,metadata:metadata});
}})});
send({type:'shennian.ready'},'*');
})();
</script>` : ''}`
  // The trusted bootstrap must precede EVERY untrusted script, even malformed scripts before <head>.
  // Nested document tags are normalized by the HTML parser; the outer doctype retains standards mode.
  const child = `<!doctype html><html><head>${childBridge}</head><body>${html}</body></html>`
  const hostBridge = bridge ? `<script>(function(){var f=document.querySelector('iframe'),last=0,pending='',auth=Array.from(crypto.getRandomValues(new Uint8Array(32))).join('-');
window.__shennianObserve=function(requestId,part){pending=requestId;f.contentWindow.postMessage({type:'shennian.observe',auth:auth,requestId:requestId,part:part},'*');};
window.__shennianInvoke=function(requestId,name,args){pending=requestId;f.contentWindow.postMessage({type:'shennian.invoke',auth:auth,requestId:requestId,name:name,args:args},'*');};
function init(){f.contentWindow.postMessage({type:'shennian.init',auth:auth},'*');}f.addEventListener('load',init);
window.addEventListener('message',function(e){
if(e.source!==f.contentWindow||!e.data)return;
if(e.data.type==='shennian.ready'){init();return;}
if(e.data.auth!==auth)return;
if(e.data.type==='shennian.observation'&&e.data.requestId===pending){pending='';var value=JSON.stringify({type:'observation',requestId:e.data.requestId,observation:e.data.observation});if(value.length<=24000&&window.ReactNativeWebView)window.ReactNativeWebView.postMessage(value);return;}
if(e.data.type==='shennian.invoked'&&e.data.requestId===pending){pending='';if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(JSON.stringify({type:'invoked',requestId:e.data.requestId,ok:e.data.ok===true}));return;}
var intent=e.data.type==='shennian.intent'&&typeof e.data.text==='string'&&e.data.text.length<=8000;
var save=e.data.type==='shennian.save'&&typeof e.data.html==='string'&&e.data.html.length<=120000;
if(!intent&&!save)return;
if(!navigator.userActivation||!navigator.userActivation.isActive||Date.now()-last<1500)return;
last=Date.now();if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(JSON.stringify(intent?{type:'intent',text:e.data.text}:{type:'save',html:e.data.html,metadata:e.data.metadata}));
});})();</script>` : ''
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><meta http-equiv="Content-Security-Policy" content="${escape(policy)}"><style>html,body,iframe{margin:0;width:100%;height:100%;border:0;overflow:hidden}body{background:transparent}</style></head><body><iframe title="Interactive content" sandbox="allow-scripts" referrerpolicy="no-referrer" srcdoc="${escape(child)}"></iframe>${hostBridge}</body></html>`
}
