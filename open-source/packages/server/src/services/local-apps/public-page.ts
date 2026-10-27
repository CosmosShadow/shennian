// @arch open-source/docs/server-runtime.md
// @test src/__tests__/local-app-sharing.test.ts
const js = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c')
/** Trusted shell holds the temporary credential; the opaque sandbox never sees it. */
export function publicShell(base: string, entryPath: string, visitor: string, nonce: string) {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>分享的应用</title><style>html,body,iframe{margin:0;width:100%;height:100%;border:0}#notice{position:fixed;bottom:0;background:#fff;color:#555;font:12px system-ui;padding:4px}</style><iframe id="app" sandbox="allow-scripts allow-forms" title="分享的应用"></iframe><script nonce="${nonce}">
const frame=document.getElementById('app'),base=${js(base)},visitor=${js(visitor)};frame.src=base+'/page'+${js(entryPath)};
let pending=0;window.addEventListener('message',async e=>{if(e.source!==frame.contentWindow||e.origin!=='null'||!e.data||e.data.kind!=='public-service')return;const {id,method,path,args}=e.data;if(typeof id!=='string'||id.length>40)return;const send=result=>frame.contentWindow.postMessage({kind:'public-result',id,...result},'*');if(pending>=4)return send({error:'service_busy'});pending++;try{const r=await fetch(base+'/service',{method:'POST',credentials:'omit',headers:{'content-type':'application/json','x-local-visitor':visitor},body:JSON.stringify({method,path,args}),signal:AbortSignal.timeout(22000)});const value=await r.json();if(!r.ok)throw Error(value.error||'service_unavailable');send({value});}catch{send({error:'提交未确认，请保留内容后重试；若链接已过期，请重新打开。'});}finally{pending--;}});
</script></html>`
}
export function publicSdk() {
  return `<script>(()=>{const pending=new Map();let seq=0;window.addEventListener('message',e=>{if(e.source!==parent||e.data?.kind!=='public-result')return;const p=pending.get(e.data.id);if(!p)return;pending.delete(e.data.id);clearTimeout(p.timer);e.data.error?p.reject(Error(e.data.error)):p.resolve(e.data.value);});const service=(method,path,args)=>new Promise((resolve,reject)=>{if(pending.size>=4)return reject(Error('service_busy'));const id=String(++seq),timer=setTimeout(()=>{pending.delete(id);reject(Error('提交未确认，请重试'));},25000);pending.set(id,{resolve,reject,timer});parent.postMessage({kind:'public-service',id,method,path,args},'*');});window.shennian=Object.freeze({public:Object.freeze({service})});})();</script>`
}
