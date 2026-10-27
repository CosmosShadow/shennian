// @covers src/commands/setup.ts

import fs from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadConfig, resolveShennianPath, saveConfig } from '../config/index.js'
import { runSetup, type SetupDeps, type SetupEvent } from '../commands/setup.js'
import { getStewardDir } from '../steward/workspace.js'
import path from 'node:path'
import { BrowserPairError, type BrowserPairIntent } from '../commands/pair-browser.js'
import type { DetectedAgent } from '../agents/detect.js'

const NOW = Date.parse('2026-09-29T10:00:00Z')
const intent: BrowserPairIntent = {
  serverUrl: 'https://shennian.net',
  intentId: 'intent_setup_1',
  url: 'https://shennian.net/authorize/intent_setup_1',
  expiresAt: new Date(NOW + 10 * 60_000).toISOString(),
  deviceSecret: 'secret',
  actionPayloadHash: 'a'.repeat(64),
  machineName: 'Macbook',
}
const claimed = {
  machineId: 'machine-1',
  machineToken: 'machine-token',
  accountNamespaceId: 'b'.repeat(64),
  machineName: 'Macbook',
  publicLoginUrl: intent.url,
}
const codex = { type: 'codex', command: 'codex', args: [], authState: 'ready' } as DetectedAgent
const claude = { type: 'claude', command: 'claude', args: [], authState: 'required' } as DetectedAgent

function deps(overrides: Partial<SetupDeps> = {}): SetupDeps {
  return {
    clientVersion: () => '0.5.20',
    detectAgents: async () => [codex, claude],
    unavailableAgents: () => [],
    installSkills: async () => [],
    createIntent: vi.fn(async () => intent),
    waitForIntent: vi.fn(async () => claimed),
    openUrl: vi.fn(async () => true),
    ensureDaemon: vi.fn(() => ({ status: 'started' as const })),
    now: () => NOW,
    ...overrides,
  }
}

async function run(d: SetupDeps, interactive = false) {
  const events: SetupEvent[] = []
  const done = await runSetup({ interactive, emit: (event) => events.push(event), deps: d, name: 'Macbook' })
  return { done, events }
}

beforeEach(() => {
  saveConfig({})
  try { fs.unlinkSync(resolveShennianPath('pending-pair.json')) } catch { /* none */ }
})

describe('shennian setup', () => {
  it('returns the link while approval is pending, then resumes the same request and finishes', async () => {
    const pending = deps({ waitForIntent: vi.fn(async () => null) })
    const first = await run(pending)
    expect(fs.readdirSync(getStewardDir()).sort()).toEqual(['AGENTS.md', 'CLAUDE.md', 'index.md'])
    expect(fs.readFileSync(path.join(getStewardDir(), 'CLAUDE.md'), 'utf8').trim()).toBe('@AGENTS.md')
    expect(first.done).toMatchObject({ status: 'waiting_for_approval', pairUrl: intent.url })
    expect(first.events.find((event) => event.type === 'step' && event.step === 'pair'))
      .toMatchObject({ status: 'waiting', url: intent.url, resumed: false })
    expect(pending.openUrl).toHaveBeenCalledOnce()
    expect(pending.ensureDaemon).not.toHaveBeenCalled()
    // Non-interactive callers (AI hosts) get a short wait that fits their command timeouts.
    expect(vi.mocked(pending.waitForIntent).mock.calls[0]![1]).toEqual({ deadline: NOW + 25_000 })
    expect(fs.statSync(resolveShennianPath('pending-pair.json')).mode & 0o777).toBe(0o600)

    const resumed = deps()
    const second = await run(resumed)
    expect(resumed.createIntent).not.toHaveBeenCalled()
    expect(resumed.openUrl).not.toHaveBeenCalled()
    expect(second.events.find((event) => event.type === 'step' && event.step === 'pair'))
      .toMatchObject({ resumed: true })
    expect(loadConfig()).toMatchObject({ machineId: 'machine-1', machineToken: 'machine-token', serverUrl: 'https://shennian.net' })
    expect(resumed.ensureDaemon).toHaveBeenCalledWith({ resumePaused: true })
    expect(second.done).toMatchObject({ status: 'ready' })
    expect(second.done.message).toContain('Codex')
    expect(fs.existsSync(resolveShennianPath('pending-pair.json'))).toBe(false)
  })

  it('waits for the whole request in an interactive terminal', async () => {
    const d = deps()
    await run(d, true)
    expect(vi.mocked(d.waitForIntent).mock.calls[0]![1]).toEqual({ deadline: NOW + 600_000 })
  })

  it('creates a new link when the saved request is about to expire', async () => {
    fs.writeFileSync(resolveShennianPath('pending-pair.json'), JSON.stringify({
      ...intent, expiresAt: new Date(NOW + 30_000).toISOString(),
    }))
    const d = deps()
    await run(d)
    expect(d.createIntent).toHaveBeenCalledOnce()
  })

  it('skips pairing on an already paired machine and keeps a person’s pause', async () => {
    saveConfig({ machineId: 'machine-1', machineToken: 'machine-token' })
    const d = deps({ ensureDaemon: vi.fn(() => ({ status: 'paused' as const })) })
    const { done } = await run(d)
    expect(d.createIntent).not.toHaveBeenCalled()
    expect(d.ensureDaemon).toHaveBeenCalledWith({ resumePaused: false })
    expect(done).toMatchObject({ status: 'needs_attention' })
    expect(done.nextAction).toContain('shennian start')
  })

  it('explains what to do when no AI tool is ready', async () => {
    saveConfig({ machineId: 'machine-1', machineToken: 'machine-token' })
    const none = await run(deps({ detectAgents: async () => [] }))
    expect(none.done).toMatchObject({ status: 'needs_attention' })
    expect(none.done.message).toContain('没有找到可用的 AI')
    const loginOnly = await run(deps({ detectAgents: async () => [claude] }))
    expect(loginOnly.done.nextAction).toContain('Claude Code')
  })

  it('lists installed tools that are not connected and asks the AI to offer connecting them', async () => {
    saveConfig({ machineId: 'machine-1', machineToken: 'machine-token' })
    const { done, events } = await run(deps({
      unavailableAgents: () => [{ type: 'acp:dsh', name: 'DSH', command: 'dsh', args: ['--profile', 'acp'], reason: 'timeout' }],
    }))
    expect(events.find((event) => event.type === 'step' && event.step === 'agents')).toMatchObject({
      status: 'attention',
      message: expect.stringContaining('已安装但还没接上：DSH（启动超时）'),
      unavailable: [{ type: 'acp:dsh', command: 'dsh --profile acp', reason: 'timeout' }],
    })
    expect(done).toMatchObject({ status: 'ready' })
    expect(done.nextAction).toContain('DSH 已安装但还没接上')
  })

  it('reports a denied request and forgets it so the next run starts fresh', async () => {
    const d = deps({ waitForIntent: vi.fn(async () => { throw new BrowserPairError('PAIR_DENIED', 'denied') }) })
    const { done } = await run(d)
    expect(done).toMatchObject({ status: 'failed' })
    expect(done.nextAction).toContain('shennian setup')
    expect(fs.existsSync(resolveShennianPath('pending-pair.json'))).toBe(false)
    expect(loadConfig().machineToken).toBeUndefined()
  })
})
