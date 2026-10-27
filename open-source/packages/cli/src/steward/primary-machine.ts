// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/personal-workspace.test.ts
import { loadConfig } from '../config/index.js'
import { SERVERS } from '../region.js'
/** Public Client operation. Credentials stay inside the request, never in output. */
export async function primaryMachineRequest(input?: { expectedRevision: number; confirmed: true }, fetchImpl: typeof fetch = fetch) {
  const config = loadConfig()
  if (!config.machineToken || !config.machineId) throw new Error('not_paired')
  const response = await fetchImpl(`${(config.serverUrl ?? SERVERS.cn.url).replace(/\/$/, '')}/api/personal-workspace/primary-machine-cli`, {
    method: input ? 'PUT' : 'GET', redirect: 'error', signal: AbortSignal.timeout(30000),
    headers: { authorization: `Bearer ${config.machineToken}`, 'content-type': 'application/json' },
    ...(input ? { body: JSON.stringify({ ...input, machineId: config.machineId }) } : {}),
  })
  if (!response.ok) throw new Error(response.status === 409 ? 'personal_primary_conflict' : 'personal_primary_request_failed')
  return response.json() as Promise<{ machine: { id: string; name: string; online: boolean } | null; revision: number }>
}
