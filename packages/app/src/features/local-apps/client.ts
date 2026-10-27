// @arch docs/architecture/local-apps.md
// @test src/__tests__/interactive-content-session.test.ts
import type { LocalApp, PersonalServiceResponse } from '@shennian/wire'
import { personalServiceInput } from '@shennian/wire'
import { authApi } from '../../config/api'
export type LocalMachine = { id: string; name: string; online: boolean }
const post = <T>(path: string, body: unknown) => authApi<T>('/local-apps' + path, { method: 'POST', body: JSON.stringify(body) }, { timeoutMs: 25000 })
export const localAppsClient = {
  machines: () => authApi<{ machines: LocalMachine[] }>('/local-apps/machines'),
  apps: (machineId: string) => authApi<{ apps: LocalApp[] }>(`/local-apps/machines/${encodeURIComponent(machineId)}/apps`, {}, { timeoutMs: 25000 }),
  remove: (machineId: string, appId: string) => authApi(`/local-apps/machines/${encodeURIComponent(machineId)}/apps/${encodeURIComponent(appId)}`, { method: 'DELETE' }),
  runtime: (machineId: string, appId: string) => post<{ runtimePath: string; expiresIn: number }>('/runtime', { machineId, appId }),
  service: (machineId: string, request: unknown) => post<PersonalServiceResponse>('/service', { machineId, ...personalServiceInput(request) }),
}
/** The page cannot select another machine, app, port or access registry/RPC methods. */
export function pageServiceMessage(data: string, machineId: string, app: LocalApp) {
  if (data.length > 300000) throw new Error('invalid_service_request')
  const p = JSON.parse(data)
  if (p.kind !== 'local-service' || typeof p.id !== 'string' || !/^\d{1,12}$/.test(p.id) || p.machineId !== machineId || p.port !== app.port) throw new Error('invalid_service_request')
  return { id: p.id as string, input: personalServiceInput({ appId: app.id, port: app.port, method: p.method, path: p.path, ...(p.args !== undefined ? { args: p.args } : {}) }) }
}
export function runtimeUrl(base: string, path: string) {
  if (!/^\/local-apps\/runtime\/[a-f0-9]{48}\//.test(path)) throw new Error('invalid_runtime')
  return new URL(base.replace(/\/$/, '') + path).toString()
}
