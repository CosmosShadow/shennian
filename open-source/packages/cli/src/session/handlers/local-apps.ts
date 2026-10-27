// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/local-apps.test.ts
import type { ReqFrame } from '@shennian/wire'
import type { SessionManagerRuntime } from '../types.js'
import { localApps } from '../../local-apps/service.js'
export async function handleLocalApps(runtime: SessionManagerRuntime, req: ReqFrame) {
  try {
    let payload: unknown
    if (req.method === 'personal.apps.list') payload = { apps: await localApps.list() }
    else if (req.method === 'personal.apps.register') payload = { app: await localApps.register(req.params) }
    else if (req.method === 'personal.apps.remove') payload = await localApps.remove(String((req.params as { appId?: unknown })?.appId ?? ''))
    else payload = await localApps.request(req.params)
    runtime.client.sendRes({ type: 'res', id: req.id, ok: true, payload })
  } catch (error) {
    const known = error instanceof Error && /^(invalid_|local_app_|service_)/.test(error.message)
    runtime.client.sendRes({ type: 'res', id: req.id, ok: false, error: known ? error.message : 'local_service_unavailable' })
  }
}
