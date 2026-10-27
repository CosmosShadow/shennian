// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/model-switching.test.ts

import type { ReqFrame } from '@shennian/wire'
import { SERVERS, type Region } from '../../region.js'
import { loadConfig, saveConfig } from '../../config/index.js'
import type { SessionManagerRuntime } from '../types.js'

export async function handleRegionProbe(runtime: SessionManagerRuntime, req: ReqFrame): Promise<void> {
  const currentRegion: Region = 'cn'

  const results = await Promise.all(
    (Object.keys(SERVERS) as Region[]).map(async (region) => {
      const { url, label } = SERVERS[region]
      const start = performance.now()
      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 5000)
        await fetch(`${url}/health`, { signal: controller.signal })
        clearTimeout(timer)
        return { region, url, label, latencyMs: Math.round(performance.now() - start) }
      } catch {
        return { region, url, label, latencyMs: null }
      }
    }),
  )

  runtime.client.sendRes({
    type: 'res',
    id: req.id,
    ok: true,
    payload: { current: currentRegion, servers: results },
  })
}

export async function handleRegionSwitch(runtime: SessionManagerRuntime, req: ReqFrame): Promise<void> {
  const targetRegion = req.params.region as Region
  if (targetRegion !== 'cn' && targetRegion !== 'global') {
    runtime.client.sendRes({ type: 'res', id: req.id, ok: false, error: 'region must be "cn" or "global"' })
    return
  }

  const config = loadConfig()
  config.serverUrl = SERVERS[targetRegion].url
  saveConfig(config)

  runtime.client.sendRes({
    type: 'res',
    id: req.id,
    ok: true,
    payload: { region: targetRegion, url: SERVERS[targetRegion].url },
  })

  setTimeout(() => process.exit(0), 500)
}

export async function handleUpgradeSetPolicy(runtime: SessionManagerRuntime, req: ReqFrame): Promise<void> {
  const policy = req.params.policy as string
  if (policy !== 'none' && policy !== 'patch') {
    runtime.client.sendRes({ type: 'res', id: req.id, ok: false, error: 'policy must be "none" or "patch"' })
    return
  }

  const config = loadConfig()
  config.autoUpgrade = policy
  saveConfig(config)
  runtime.upgradePolicyController?.setPolicy(policy)
  runtime.client.sendEvent({
    type: 'event',
    event: 'machine.upgrade-policy',
    payload: { policy },
  })
  runtime.client.sendRes({ type: 'res', id: req.id, ok: true, payload: { autoUpgrade: policy } })
}
