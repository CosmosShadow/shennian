// @arch open-source/docs/server-runtime.md
// @test src/__tests__/health.test.ts

import './env.js'
import { hostname } from 'node:os'
import { buildApp, type BuildAppOptions } from './core.js'
import { getDefaultRealtimeAsrProvider } from './services/voice-asr.js'

export async function startServer(options: BuildAppOptions = {}): Promise<void> {
  const port = Number(process.env.PORT) || 3000
  const instanceId = process.env.INSTANCE_ID?.trim() || hostname()
  const release = process.env.SHENNIAN_RELEASE?.trim() || 'development'
  const app = await buildApp(options)

  app.log.info(
    {
      role: 'server',
      instanceId,
      release,
      voiceAsrProvider: getDefaultRealtimeAsrProvider(),
      hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
    },
    'server env ready',
  )

  await app.listen({ host: '0.0.0.0', port })

  let stopping = false
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      if (stopping) return
      stopping = true
      app.log.info({ role: 'server', instanceId, signal }, 'server stopping')
      void app.close()
        .then(() => process.exit(0))
        .catch((error) => {
          app.log.error({ role: 'server', instanceId, signal, error }, 'server shutdown failed')
          process.exit(1)
        })
    })
  }
}
