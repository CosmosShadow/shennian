// @covers open-source/packages/cli/src/agents/node-adapter.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { discoverNodeAdapterModels, NodeAdapterAgent } from '../agents/node-adapter.js'
import { hashAdapterFile, type NodeAdapterRegistration } from '../adapter-kit/registry.js'
import type { AgentEvent } from '../agents/adapter.js'

const HOST_SOURCE_PATH = fileURLToPath(new URL('../../bin/shennian-adapter-host.ts', import.meta.url))
const TSX_LOADER_PATH = createRequire(import.meta.url).resolve('tsx')
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function createFixture(): NodeAdapterRegistration {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'node-adapter-agent-'))
  roots.push(root)
  const entryPath = path.join(root, 'adapter.mjs')
  fs.writeFileSync(path.join(root, 'models.json'), JSON.stringify({ models: ['model-a'], defaultModel: 'model-a' }))
  fs.writeFileSync(entryPath, `
import fs from 'node:fs'
import path from 'node:path'
export default {
  name: 'Runtime Bridge Fixture',
  version: '1.0.0',
  async listModels({ workDir }) {
    return JSON.parse(fs.readFileSync(path.join(workDir, 'models.json'), 'utf8'))
  },
  async start({ sessionId, systemPrompt }) {
    return { session: { systemPrompt }, nativeSessionId: \`native-\${sessionId}\` }
  },
  async send({ session, text, output }) {
    output.delta(\`\${session.systemPrompt}|\${text}\`)
    output.final()
  },
  async stop() {},
  async resume({ nativeSessionId, systemPrompt }) {
    return { session: { systemPrompt }, nativeSessionId }
  },
}
`)
  return {
    entryPath,
    entrySha256: hashAdapterFile(entryPath),
    checkedAt: new Date().toISOString(),
    registeredAt: new Date().toISOString(),
    name: 'Runtime Bridge Fixture',
    version: '1.0.0',
    workDir: root,
    models: ['model-a'],
    defaultModel: 'model-a',
  }
}

function terminalEvent(adapter: NodeAdapterAgent): Promise<AgentEvent> {
  return new Promise((resolve) => {
    const listener = (event: AgentEvent) => {
      if (!['final', 'error', 'aborted'].includes(event.state)) return
      adapter.off('agentEvent', listener)
      resolve(event)
    }
    adapter.on('agentEvent', listener)
  })
}

describe('Node Adapter V1 Agent bridge', () => {
  it('runs checked local adapters through the Runtime subprocess and resumes the exact native session', async () => {
    const registration = createFixture()
    const options = { hostPath: HOST_SOURCE_PATH, nodeArgs: ['--import', TSX_LOADER_PATH], timeoutMs: 15_000 }
    const first = new NodeAdapterAgent('runtime-fixture', registration, options)
    const firstEvents: AgentEvent[] = []
    const nativeIds: string[] = []
    first.on('agentEvent', (event) => firstEvents.push(event))
    first.on('nativeSession', (_type, id) => nativeIds.push(id))
    await first.start('session-a', path.dirname(registration.entryPath))
    const firstTerminal = terminalEvent(first)
    await first.send('hello', 'model-a', undefined, undefined, 'SYSTEM_A')
    await expect(firstTerminal).resolves.toMatchObject({ state: 'final', agentSessionId: 'native-session-a' })
    expect(firstEvents).toContainEqual(expect.objectContaining({ state: 'delta', text: 'SYSTEM_A|hello' }))
    expect(nativeIds).toEqual(['native-session-a'])
    await first.stop()

    const resumed = new NodeAdapterAgent('runtime-fixture', registration, options)
    const resumedEvents: AgentEvent[] = []
    resumed.on('agentEvent', (event) => resumedEvents.push(event))
    await resumed.start('session-b', path.dirname(registration.entryPath), 'native-session-a')
    const resumedTerminal = terminalEvent(resumed)
    await resumed.send('again', 'model-a', undefined, undefined, 'SYSTEM_A')
    await expect(resumedTerminal).resolves.toMatchObject({ state: 'final', agentSessionId: 'native-session-a' })
    expect(resumedEvents).toContainEqual(expect.objectContaining({ state: 'delta', text: 'SYSTEM_A|again' }))
    await resumed.stop()
  }, 30_000)

  it('refreshes dynamic models through listModels without loading user code in the daemon', async () => {
    const registration = createFixture()
    const options = { hostPath: HOST_SOURCE_PATH, nodeArgs: ['--import', TSX_LOADER_PATH], timeoutMs: 15_000 }
    await expect(discoverNodeAdapterModels(registration, options)).resolves.toEqual([
      { id: 'model-a', name: 'model-a', isDefault: true },
    ])
    fs.writeFileSync(
      path.join(registration.workDir, 'models.json'),
      JSON.stringify({ models: [{ id: 'model-b', name: 'Model B' }, 'model-c'], defaultModel: 'model-c' }),
    )
    await expect(discoverNodeAdapterModels(registration, options)).resolves.toEqual([
      { id: 'model-b', name: 'Model B', isDefault: false },
      { id: 'model-c', name: 'model-c', isDefault: true },
    ])
  }, 30_000)
})
