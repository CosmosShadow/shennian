// @covers src/agents/acp/discovery.ts

import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createAgent } from '../agents/adapter.js'
import { discoverAcpAgents, getUnavailableAcpAgents } from '../agents/acp/discovery.js'
import { getAcpLocalMetrics } from '../agents/acp/metrics.js'
import { fingerprintNativeExecutable } from '../security/managed-agent-executable.js'

const fixture = fileURLToPath(new URL('./fixtures/acp-test-agent.mjs', import.meta.url))
const previousHome = process.env.SHENNIAN_HOME

afterEach(() => {
  if (previousHome === undefined) delete process.env.SHENNIAN_HOME
  else process.env.SHENNIAN_HOME = previousHome
})

describe('ACP discovery', () => {
  it('only advertises an installed candidate after a successful ACP v1 handshake', async () => {
    const detected = await discoverAcpAgents({ candidates: [{
      id: 'fixture-agent',
      name: 'Fixture Agent',
      source: 'registry',
      launch: { command: process.execPath, args: [fixture] },
    }] })
    expect(detected).toHaveLength(1)
    expect(detected[0]).toMatchObject({
      type: 'acp:fixture-agent',
      integration: 'acp',
      authState: 'ready',
      display: { name: 'Fixture Agent', version: '1.0.0' },
      executableFingerprint: fingerprintNativeExecutable(process.execPath),
      acpCapabilities: { protocolVersion: 1, listSessions: true, loadSession: true, resumeSession: true },
    })
    expect(createAgent('acp:fixture-agent')).not.toBeNull()
  })

  it('does not advertise missing commands or download packages during discovery', async () => {
    const detected = await discoverAcpAgents({ candidates: [{
      id: 'missing-agent', name: 'Missing Agent', source: 'registry',
      launch: { command: 'definitely-not-installed-shennian-acp-test', args: [] },
    }] })
    expect(detected).toEqual([])
  })

  it('reports an installed tool whose ACP handshake fails, and forgets it once it connects', async () => {
    const broken = {
      id: 'broken-agent', name: 'Broken Agent', source: 'registry' as const,
      launch: { command: process.execPath, args: ['-e', 'process.exit(3)'] },
    }
    const missing = {
      id: 'missing-agent', name: 'Missing Agent', source: 'registry' as const,
      launch: { command: 'definitely-not-installed-shennian-acp-test', args: [] },
    }
    expect(await discoverAcpAgents({ candidates: [broken, missing] })).toEqual([])
    expect(getUnavailableAcpAgents()).toEqual([expect.objectContaining({
      type: 'acp:broken-agent', name: 'Broken Agent', command: process.execPath, reason: expect.any(String),
    })])

    await discoverAcpAgents({ candidates: [{ ...broken, launch: { command: process.execPath, args: [fixture] } }] })
    expect(getUnavailableAcpAgents()).toEqual([])
  })

  it('tries another Registry command for the same Agent when the first is not installed', async () => {
    const detected = await discoverAcpAgents({ candidates: [
      {
        id: 'alternate-agent', name: 'Alternate Agent', source: 'registry',
        launch: { command: 'definitely-not-installed-shennian-acp-test', args: [] },
      },
      {
        id: 'alternate-agent', name: 'Alternate Agent', source: 'registry',
        launch: { command: process.execPath, args: [fixture] },
      },
    ] })
    expect(detected.map((item) => item.type)).toEqual(['acp:alternate-agent'])
  })

  it('reuses capabilities only while executable, launch config, platform, and revision match', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-acp-discovery-'))
    const starts = path.join(home, 'starts.txt')
    process.env.SHENNIAN_HOME = home
    const candidates = [{
      id: 'cached-agent',
      name: 'Cached Agent',
      source: 'registry' as const,
      launch: { command: process.execPath, args: [fixture], env: { ACP_FIXTURE_START_FILE: starts } },
    }]
    await discoverAcpAgents({ candidates })
    await discoverAcpAgents({ candidates })
    expect(fs.readFileSync(starts, 'utf8').trim().split('\n')).toHaveLength(1)
    expect(getAcpLocalMetrics()).toMatchObject({ scans: expect.any(Number), cacheHits: expect.any(Number) })
    expect(getAcpLocalMetrics().cacheHits).toBeGreaterThan(0)
  })

  it('keeps the last known-good factory available while a refresh is still probing', async () => {
    const candidate = {
      id: 'refresh-agent',
      name: 'Refresh Agent',
      source: 'registry' as const,
      launch: { command: process.execPath, args: [fixture] },
    }
    await discoverAcpAgents({ candidates: [candidate] })
    expect(createAgent('acp:refresh-agent')).not.toBeNull()

    const refresh = discoverAcpAgents({
      candidates: [{ ...candidate, launch: { command: process.execPath, args: [fixture, 'delay-initialize'] } }],
    })
    expect(createAgent('acp:refresh-agent')).not.toBeNull()
    await refresh
    expect(createAgent('acp:refresh-agent')).not.toBeNull()
  })
})
