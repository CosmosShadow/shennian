// @arch open-source/docs/cli-runtime.md
// @covers src/native-fusion/state.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let tempHome: string

function scannerStateFile(): string {
  return path.join(tempHome, 'personal-sync', '2', 'native-fusion-state.json')
}

beforeEach(() => {
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'native-fusion-state-'))
  vi.stubEnv('SHENNIAN_HOME', tempHome)
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.resetModules()
  fs.rmSync(tempHome, { recursive: true, force: true })
})

describe('native fusion v1 scanner state', () => {
  it('creates one durable scanner baseline in the machine epoch root', async () => {
    const epoch = Date.parse('2026-09-01T08:00:00.000Z')
    vi.setSystemTime(epoch)
    const stateModule = await import('../native-fusion/state.js')
    const first = stateModule.loadNativeScannerState()

    expect(first).toMatchObject({ schemaVersion: 1, fusionEpochMs: epoch, files: {} })
    expect(first.daemonInstallationId).toBeTruthy()
    expect(fs.existsSync(scannerStateFile())).toBe(true)
    expect(fs.existsSync(path.join(tempHome, 'native-fusion-state.json'))).toBe(false)

    vi.setSystemTime(epoch + 60_000)
    vi.resetModules()
    const reloadedModule = await import('../native-fusion/state.js')
    const reloaded = reloadedModule.loadNativeScannerState()
    expect(reloaded.fusionEpochMs).toBe(epoch)
    expect(reloaded.daemonInstallationId).toBe(first.daemonInstallationId)
  })

  it('rejects epoch rewrites and malformed state instead of silently rebaselining', async () => {
    const stateModule = await import('../native-fusion/state.js')
    const state = stateModule.loadNativeScannerState()
    expect(() => stateModule.saveNativeScannerState({
      ...state,
      fusionEpochMs: state.fusionEpochMs + 1,
    })).toThrow('epoch is immutable')

    fs.writeFileSync(
      scannerStateFile(),
      'not-json',
    )
    expect(() => stateModule.loadNativeScannerState()).toThrow('unreadable')
  })

  it('binds every persisted source cursor to the daemon installation', async () => {
    const stateModule = await import('../native-fusion/state.js')
    const state = stateModule.loadNativeScannerState()
    state.files['/tmp/rollout.jsonl'] = {
      daemonInstallationId: state.daemonInstallationId,
      offset: 42,
      mtimeMs: 1,
      classification: 'live',
      sources: [{ agentType: 'codex', sourceSessionKey: 'thread-1' }],
    }
    stateModule.saveNativeScannerState(state)
    expect(stateModule.loadNativeScannerState().files['/tmp/rollout.jsonl']).toMatchObject({
      daemonInstallationId: state.daemonInstallationId,
      offset: 42,
      sources: [{ agentType: 'codex', sourceSessionKey: 'thread-1' }],
    })

    state.files['/tmp/rollout.jsonl']!.daemonInstallationId = 'another-installation'
    expect(() => stateModule.saveNativeScannerState(state)).toThrow(
      'cursor belongs to another daemon installation',
    )
  })

  it('persists internal native sources that must never become personal sessions', async () => {
    const stateModule = await import('../native-fusion/state.js')
    const state = stateModule.loadNativeScannerState()
    state.ignoredSources = { 'codex:validation-thread': true }
    stateModule.saveNativeScannerState(state)

    expect(stateModule.loadNativeScannerState().ignoredSources).toEqual({
      'codex:validation-thread': true,
    })
  })
  it('retains every internal provider ID across restart and a stale cooperative scan save', async () => {
    const state = await import('../native-fusion/state.js')
    const { registerInternalNativeSource, isInternalNativeSource } = await import('../native-fusion/source-visibility.js')
    const stale = state.loadNativeScannerState()
    registerInternalNativeSource('sess_worker_a', 'codex', 'old-thread')
    registerInternalNativeSource('sess_worker_a', 'codex', 'replacement-thread')
    state.saveNativeScannerState(stale)
    vi.resetModules()
    const reloaded = (await import('../native-fusion/state.js')).loadNativeScannerState()
    expect(Object.keys(reloaded.internalSourceOwners ?? {})).toEqual(['codex:old-thread', 'codex:replacement-thread'])
    expect(isInternalNativeSource('codex', 'old-thread')).toBe(true)
    expect(isInternalNativeSource('codex', 'replacement-thread')).toBe(true)
    expect(isInternalNativeSource('codex', 'normal-thread')).toBe(false)
    expect(() => registerInternalNativeSource('another-owner', 'codex', 'old-thread')).toThrow('owner_conflict')
    expect(() => state.saveNativeScannerState({ ...reloaded, internalSourceOwners: {
      'codex:bad': { sessionId: '', registeredAt: 'bad' },
    } })).toThrow('invalid internal native source ownership')
  })

  it('audits only exact owners without applying cleanup or relying on title text', async () => {
    const { auditInternalNativeVisibility } = await import('../native-fusion/source-visibility-audit.js')
    const root = path.dirname(scannerStateFile())
    fs.mkdirSync(path.join(root, 'native-fusion'), { recursive: true })
    const originalState = JSON.stringify({ daemonInstallationId: 'audit-installation' })
    fs.writeFileSync(scannerStateFile(), originalState)
    fs.writeFileSync(path.join(root, 'session-index.json'), JSON.stringify({
      owner: { sessionId: 'sess_worker_owner', daemonInstallationId: 'audit-installation', agentType: 'codex', agentSessionId: 'internal' },
      normal: { sessionId: 'normal', daemonInstallationId: 'audit-installation', agentType: 'codex', agentSessionId: 'user', title: 'Manager Worker' },
    }))
    fs.writeFileSync(path.join(root, 'native-fusion/sources.json'), JSON.stringify({ sources: {
      internal: { sessionId: 'native-copy', agentType: 'codex', sourceSessionKey: 'internal', daemonInstallationId: 'audit-installation' },
      user: { sessionId: 'normal', agentType: 'codex', sourceSessionKey: 'user', daemonInstallationId: 'audit-installation' },
    } }))
    const report = auditInternalNativeVisibility(root)
    expect(report.counts).toEqual({ knownInternalSources: 1, importedSources: 2, confirmedDuplicateProjections: 1 })
    expect(report.confirmed).toEqual([{ sourceKey: 'codex:internal', canonicalSessionId: 'sess_worker_owner', importedSessionId: 'native-copy' }])
    expect(report.actionsApplied).toBe(0)
    expect(fs.readFileSync(scannerStateFile(), 'utf8')).toBe(originalState)
  })

})
