// @covers open-source/packages/cli/src/commands/upgrade.ts
// @arch open-source/docs/cli-runtime.md
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(), launch: vi.fn(), release: vi.fn(), cooldown: vi.fn(), service: vi.fn(), ready: vi.fn(), confirm: vi.fn(),
}))
vi.mock('../upgrade/updater-worker.js', () => ({ assertUpdaterAvailable: vi.fn(), prepareUpdaterCandidate: mocks.prepare }))
vi.mock('../upgrade/updater-service-entry.js', () => ({ prepareRecoveryServiceEntry: mocks.service }))
vi.mock('../upgrade/updater-bootstrap.js', () => ({ ensureUpdaterInstalled: () => ({ workerPath: '/worker.js' }) }))
vi.mock('../upgrade/updater-launcher.js', () => ({
  createUpdaterJob: (input: object) => ({ ...input, resultPath: '/result.json', isolatedDaemonStart: process.env.SHENNIAN_DAEMON_SUPERVISOR === 'docker' }), launchUpdater: mocks.launch, waitForUpdaterReady: mocks.ready, confirmUpdaterHandoff: mocks.confirm,
}))
vi.mock('../upgrade/engine.js', () => ({
  acquireUpgradeLock: () => ({ release: mocks.release }), recordUpgradeFailure: mocks.cooldown,
  compareVersions: () => 'patch', getCurrentVersion: () => '1.0.0',
}))
import { handleUpgradeStart } from '../commands/upgrade.js'

beforeEach(() => { vi.clearAllMocks(); mocks.prepare.mockResolvedValue(undefined); mocks.launch.mockReturnValue({}) })

describe('non-disruptive preparation boundary', () => {
  it('uses a container-safe updater handoff when running under Docker supervision', async () => {
    vi.stubEnv('SHENNIAN_DAEMON_SUPERVISOR', 'docker')
    try {
      const client = { sendRes: vi.fn(), sendEvent: vi.fn() }
      const result = await handleUpgradeStart(client as never, 'docker', '1.0.1', {
        waitForCompletion: true, prepareForUpgrade: () => ({ activeRunCount: 0 }),
      })
      expect(result.ok).toBe(true)
      expect(mocks.service).toHaveBeenCalledWith(expect.objectContaining({ isolatedDaemonStart: true }), expect.anything())
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('acknowledges immediately, keeps dispatch running during download, then freezes exactly at handoff', async () => {
    let finish!: () => void
    mocks.prepare.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve }))
    const client = { sendRes: vi.fn(), sendEvent: vi.fn() }
    const freeze = vi.fn(() => ({ activeRunCount: 0 })); const shutdown = vi.fn()
    const result = await handleUpgradeStart(client as never, 'req', '1.0.1', {
      prepareForUpgrade: freeze, shutdownAfterHandoff: shutdown,
    })
    expect(result.ok).toBe(true)
    expect(client.sendRes).toHaveBeenCalledWith(expect.objectContaining({ ok: true }))
    expect(freeze).not.toHaveBeenCalled(); expect(shutdown).not.toHaveBeenCalled()
    finish()
    await vi.waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce())
    expect(mocks.prepare.mock.invocationCallOrder[0]).toBeLessThan(freeze.mock.invocationCallOrder[0])
    expect(mocks.launch.mock.invocationCallOrder[0]).toBeLessThan(freeze.mock.invocationCallOrder[0])
    expect(shutdown).not.toHaveBeenCalled()
    expect(mocks.release).toHaveBeenCalledOnce()
  })

  it('reports download failure without freezing, stopping, or scheduling the worker', async () => {
    mocks.prepare.mockRejectedValueOnce(new Error('network_timeout'))
    const client = { sendRes: vi.fn(), sendEvent: vi.fn() }
    const freeze = vi.fn(); const shutdown = vi.fn()
    const result = await handleUpgradeStart(client as never, 'auto', '1.0.1', {
      suppressResponse: true, waitForCompletion: true, prepareForUpgrade: freeze, shutdownAfterHandoff: shutdown,
    })
    expect(result.ok).toBe(false)
    expect(freeze).not.toHaveBeenCalled(); expect(shutdown).not.toHaveBeenCalled()
    expect(mocks.launch).not.toHaveBeenCalled()
    expect(mocks.cooldown).toHaveBeenCalledWith('1.0.1', 'network_timeout')
    expect(client.sendEvent).toHaveBeenLastCalledWith(expect.objectContaining({ payload: expect.objectContaining({ state: 'failed' }) }))
  })

  it('rechecks ordinary patch idle after preparation, without penalizing newly arrived work', async () => {
    const freeze = vi.fn()
    await handleUpgradeStart({ sendEvent: vi.fn() } as never, 'auto', '1.0.1', {
      suppressResponse: true, waitForCompletion: true, canHandoff: () => false, prepareForUpgrade: freeze,
    })
    expect(freeze).not.toHaveBeenCalled(); expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.cooldown).not.toHaveBeenCalled()
  })

  it('does not freeze if the independent worker cannot be launched', async () => {
    mocks.launch.mockImplementationOnce(() => { throw new Error('handoff_failed') })
    const cancel = vi.fn(); const shutdown = vi.fn()
    await handleUpgradeStart({ sendEvent: vi.fn() } as never, 'auto', '1.0.1', {
      suppressResponse: true, waitForCompletion: true, prepareForUpgrade: () => ({ activeRunCount: 0 }),
      cancelUpgradePreparation: cancel, shutdownAfterHandoff: shutdown,
    })
    expect(cancel).not.toHaveBeenCalled(); expect(shutdown).not.toHaveBeenCalled()
  })
})
