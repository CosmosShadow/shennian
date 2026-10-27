// @arch open-source/docs/server-runtime.md
// @test src/__tests__/acp-registry.test.ts

import cron from 'node-cron'
import { withDistributedLease } from '../services/distributed-lease.js'
import { refreshAcpRegistry } from '../services/acp-registry.js'

let task: ReturnType<typeof cron.schedule> | null = null
let active: Promise<void> | null = null

function run(): void {
  if (process.env.ACP_REGISTRY_REFRESH_DISABLED === '1') return
  if (active) return
  active = withDistributedLease({
    name: 'acp-registry-refresh',
    ttlMs: 5 * 60_000,
    run: async () => { await refreshAcpRegistry() },
  }).then(() => undefined).catch((error) => {
    console.error('[acp-registry] refresh failed', { message: error instanceof Error ? error.message : 'unknown' })
  }).finally(() => { active = null })
}

export function startAcpRegistryJob(): void {
  if (task) return
  task = cron.schedule('17 */6 * * *', run)
  run()
}

export async function stopAcpRegistryJob(): Promise<void> {
  task?.stop(); task?.destroy(); task = null
  await active
}
