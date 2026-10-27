// @arch docs/architecture/local-apps.md
// @test src/__tests__/interactive-content-session.test.ts
import type { LocalApp } from '@shennian/wire'
import { pageServiceMessage } from './client'
export function createPageServiceBridge(app: LocalApp, machineId: string, options: {
  alive(): boolean; call(input: unknown): Promise<unknown>; deliver(id: string, result: { value?: unknown; error?: string }): void
}) {
  let epoch = 0, disposed = false
  const pending = new Set<string>()
  return {
    invalidate() { epoch++; pending.clear() },
    dispose() { disposed = true; epoch++; pending.clear() },
    async receive(data: string) {
      const started = epoch
      let key: string | undefined, id: string | undefined
      const live = () => !disposed && started === epoch && options.alive()
      try {
        if (!live()) return
        if (data.length <= 300000) { const raw = JSON.parse(data); if (raw.kind === 'local-service' && typeof raw.id === 'string' && /^\d{1,12}$/.test(raw.id)) id = raw.id }
        const request = pageServiceMessage(data, machineId, app); id = request.id; key = started + ':' + id
        if (pending.has(key) || pending.size >= 8) return
        pending.add(key)
        const value = await options.call(request.input)
        if (live()) options.deliver(id, { value })
      } catch { if (id && live()) options.deliver(id, { error: 'local_service_unavailable' }) }
      finally { if (key) pending.delete(key) }
    },
  }
}
