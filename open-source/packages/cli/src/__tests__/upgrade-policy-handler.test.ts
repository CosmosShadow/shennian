// @covers open-source/packages/cli/src/session/handlers/control.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const configMocks = vi.hoisted(() => ({
  config: { autoUpgrade: 'none' as 'none' | 'patch' },
  saveConfig: vi.fn(),
}))

vi.mock('../config/index.js', () => ({
  loadConfig: () => configMocks.config,
  saveConfig: configMocks.saveConfig,
}))

import { handleUpgradeSetPolicy } from '../session/handlers/control.js'

describe('upgrade.set-policy', () => {
  beforeEach(() => {
    configMocks.config.autoUpgrade = 'none'
    configMocks.saveConfig.mockClear()
  })

  it('persists, hot-switches and reports the daemon policy', async () => {
    const setPolicy = vi.fn()
    const client = { sendRes: vi.fn(), sendEvent: vi.fn() }
    await handleUpgradeSetPolicy({
      client,
      upgradePolicyController: { setPolicy, getPolicy: () => 'none' },
    } as never, {
      type: 'req', id: 'req-1', method: 'upgrade.set-policy', params: { policy: 'patch' },
    })

    expect(configMocks.config.autoUpgrade).toBe('patch')
    expect(setPolicy).toHaveBeenCalledWith('patch')
    expect(client.sendEvent).toHaveBeenCalledWith(expect.objectContaining({
      event: 'machine.upgrade-policy', payload: { policy: 'patch' },
    }))
    expect(client.sendRes).toHaveBeenCalledWith(expect.objectContaining({ ok: true }))
  })

  it('rejects legacy automatic minor upgrades', async () => {
    const client = { sendRes: vi.fn(), sendEvent: vi.fn() }
    await handleUpgradeSetPolicy({ client } as never, {
      type: 'req', id: 'req-2', method: 'upgrade.set-policy', params: { policy: 'minor' },
    })
    expect(client.sendRes).toHaveBeenCalledWith(expect.objectContaining({ ok: false }))
  })

})
