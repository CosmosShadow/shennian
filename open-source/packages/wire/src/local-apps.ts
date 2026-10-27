// @arch open-source/docs/wire.md
export type LocalApp = { id: string; title: string; port: number; entryPath: string; directory: string; updatedAt: string }
export type PersonalServiceInput = { appId: string; port: number; method: 'GET' | 'POST' | 'DELETE'; path: string; args?: Record<string, unknown>; asset?: boolean }
export type PersonalServiceResponse = { status: number; headers: Record<string, string>; base64: string }
export const LOCAL_APP_MAX_BYTES = 2 * 1024 * 1024
export function localServicePath(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048 || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020#]/.test(value)) throw new Error('invalid_service_path')
  let decoded = value.split('?')[0]!
  try { for (let n = 0; n < 8; n++) { const next = decodeURIComponent(decoded); if (next === decoded) break; decoded = next }; if (decodeURIComponent(decoded) !== decoded) throw new Error() } catch { throw new Error('invalid_service_path') }
  if (decoded.startsWith('//') || decoded.split('/').some((part) => part === '..' || part === '.') || /[\\\u0000-\u001f]/.test(decoded)) throw new Error('invalid_service_path')
  return value
}
export function personalServiceInput(value: unknown): PersonalServiceInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_service_request')
  const p = value as Record<string, unknown>
  if (Object.keys(p).some((key) => !['appId', 'port', 'method', 'path', 'args', 'asset'].includes(key))) throw new Error('invalid_service_request')
  if (typeof p.appId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(p.appId) || !Number.isInteger(p.port) || Number(p.port) < 1024 || Number(p.port) > 65535) throw new Error('invalid_service_target')
  const method = typeof p.method === 'string' ? p.method.toUpperCase() : ''
  if (!['GET', 'POST', 'DELETE'].includes(method)) throw new Error('invalid_service_method')
  if (p.args !== undefined && (!p.args || typeof p.args !== 'object' || Array.isArray(p.args) || JSON.stringify(p.args).length > 64000)) throw new Error('invalid_service_args')
  if (p.asset !== undefined && typeof p.asset !== 'boolean') throw new Error('invalid_service_request')
  if (p.asset && (method !== 'GET' || p.args !== undefined)) throw new Error('invalid_asset_request')
  return { appId: p.appId, port: Number(p.port), method: method as PersonalServiceInput['method'], path: localServicePath(p.path), ...(p.args !== undefined ? { args: p.args as Record<string, unknown> } : {}), ...(p.asset ? { asset: true } : {}) }
}

/** Installs the only page-to-native capability. No account credential enters JS. */
export function localAppSdk(machineId: string, port: number): string {
  const target = JSON.stringify({ machineId, port }).replace(/</g, '\\u003c')
  return `(()=>{const target=${target}, pending=new Map();let seq=0;
const settle=(id,result)=>{const p=pending.get(id);if(!p)return;pending.delete(id);clearTimeout(p.timer);if(result.error)return p.reject(new Error(result.error));try{const r=result.value;const bytes=Uint8Array.from(atob(r.base64),c=>c.charCodeAt(0));const text=new TextDecoder().decode(bytes);p.resolve({status:r.status,headers:r.headers,body:(r.headers['content-type']||'').includes('application/json')?JSON.parse(text):text});}catch{p.reject(new Error('service_invalid_response'));}};
const service=(machine_id,port,method,path,args)=>new Promise((resolve,reject)=>{if(machine_id!==target.machineId||port!==target.port)return reject(new Error('service_target_forbidden'));if(!window.ReactNativeWebView)return reject(new Error('native_bridge_unavailable'));if(pending.size>=8)return reject(new Error('service_busy'));const id=String(++seq);const message=JSON.stringify({kind:'local-service',id,machineId:machine_id,port,method,path,args});if(message.length>300000)return reject(new Error('invalid_service_args'));const timer=setTimeout(()=>{pending.delete(id);reject(new Error('service_timeout'));},22000);pending.set(id,{resolve,reject,timer});window.ReactNativeWebView.postMessage(message);});
Object.defineProperty(window,'__shennianLocalResult',{value:settle,configurable:false});
const host=window.shennian||{};host.personal=Object.freeze({service});window.shennian=host;})();`
}
