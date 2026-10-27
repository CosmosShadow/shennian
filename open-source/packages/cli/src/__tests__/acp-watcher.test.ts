// @covers src/agents/acp/watcher.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { AcpDiscoveryWatcher } from '../agents/acp/watcher.js'

describe('AcpDiscoveryWatcher', () => {
  it('debounces manifest changes', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-acp-watch-'))
    const refresh = vi.fn(async () => {})
    const watcher = new AcpDiscoveryWatcher(refresh, { directory, debounceMs: 20, intervalMs: 60_000, catalogIntervalMs: 60_000 })
    watcher.start()
    watcher.notifyManifestChanged()
    watcher.notifyManifestChanged()
    await waitUntil(() => refresh.mock.calls.length === 1)
    expect(refresh).toHaveBeenCalledTimes(1)
    watcher.stop()
  })

  it('runs the low-frequency scan timer', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-acp-watch-'))
    const refresh = vi.fn(async () => {})
    const watcher = new AcpDiscoveryWatcher(refresh, { directory, intervalMs: 20, catalogIntervalMs: 60_000 })
    watcher.start()
    await waitUntil(() => refresh.mock.calls.length > 0)
    expect(refresh).toHaveBeenCalled()
    watcher.stop()
  })

  it('polls the mirrored Registry independently from the 12-hour filesystem scan', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-acp-watch-'))
    const refresh = vi.fn(async () => {})
    const watcher = new AcpDiscoveryWatcher(refresh, { directory, intervalMs: 60_000, catalogIntervalMs: 20 })
    watcher.start()
    await waitUntil(() => refresh.mock.calls.length > 0)
    expect(refresh).toHaveBeenCalled()
    watcher.stop()
  })
})

async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('timed out')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}
