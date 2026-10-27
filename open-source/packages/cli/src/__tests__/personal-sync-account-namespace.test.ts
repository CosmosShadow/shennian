// @covers src/personal-sync/paths.ts
// @covers src/personal-sync/identity.ts
// @covers src/personal-sync/machine-authority.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadConfig, saveConfig } from '../config/index.js'
import { synchronizeMachinePersonalAuthority } from '../personal-sync/machine-authority.js'
import { getDaemonInstallationId } from '../personal-sync/identity.js'
import { resolvePersonalSyncV1Path } from '../personal-sync/paths.js'

let home: string

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-machine-authority-'))
  vi.stubEnv('SHENNIAN_HOME', home)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
  fs.rmSync(home, { recursive: true, force: true })
})

describe('machine-owned personal sync root', () => {
  it('keeps one data root when the current account namespace changes', () => {
    saveConfig({ accountNamespaceId: 'a'.repeat(64) })
    const installationId = getDaemonInstallationId()
    const accountAPath = resolvePersonalSyncV1Path('canonical')
    fs.mkdirSync(accountAPath, { recursive: true })
    fs.writeFileSync(path.join(accountAPath, 'machine-owned'), 'present')

    saveConfig({ ...loadConfig(), accountNamespaceId: 'b'.repeat(64) })

    expect(resolvePersonalSyncV1Path('canonical')).toBe(accountAPath)
    expect(accountAPath).toBe(path.join(home, 'personal-sync', '2', 'canonical'))
    expect(fs.readFileSync(path.join(accountAPath, 'machine-owned'), 'utf8')).toBe('present')
    expect(getDaemonInstallationId()).toBe(installationId)
  })

  it('keeps canonical, cursor, title and deletion barrier across machine rebinding', async () => {
    saveConfig({ machineId: 'machine-a', machineToken: 'token-a', accountNamespaceId: 'a'.repeat(64) })
    const sessionStore = await import('../session/store.js')
    sessionStore.recordSession({
      sessionId: 'session-1', agentType: 'codex', workDir: '/repo',
      title: '机器数据', titleSource: 'agent_native', titleOriginEventId: 'title-1',
    })
    sessionStore.appendMessage('session-1', {
      id: 'message-1', sessionId: 'session-1', role: 'user', ts: 1, payload: '仍然存在',
    })
    const scanner = await import('../native-fusion/state.js')
    const state = scanner.loadNativeScannerState()
    state.files['/repo/rollout.jsonl'] = {
      daemonInstallationId: state.daemonInstallationId, offset: 42, mtimeMs: 1,
      classification: 'live', sources: [{ agentType: 'codex', sourceSessionKey: 'thread-1' }],
    }
    scanner.saveNativeScannerState(state)
    const { NativeSourceDeletionStore } = await import('../native-fusion/native-source-deletions.js')
    new NativeSourceDeletionStore().record({
      sessionId: 'deleted-1', agentType: 'codex', sourceSessionKey: 'thread-deleted', deletionRevision: 1,
    })

    saveConfig({ machineId: 'machine-b', machineToken: 'token-b', accountNamespaceId: 'b'.repeat(64) })
    vi.resetModules()

    const reboundStore = await import('../session/store.js')
    const reboundScanner = await import('../native-fusion/state.js')
    const reboundDeletion = new (
      await import('../native-fusion/native-source-deletions.js')
    ).NativeSourceDeletionStore()
    expect(reboundStore.readMessages('session-1')).toEqual([
      expect.objectContaining({ id: 'message-1', payload: '仍然存在' }),
    ])
    expect(reboundScanner.loadNativeScannerState().files['/repo/rollout.jsonl']?.offset).toBe(42)
    expect(reboundDeletion.has('codex', 'thread-deleted')).toBe(true)
  })

  it('validates machine authority without changing legacy account metadata or paths', async () => {
    saveConfig({
      machineId: 'machine-1', machineToken: 'machine-token',
      accountNamespaceId: 'a'.repeat(64),
    })
    const before = resolvePersonalSyncV1Path('canonical')
    const daemonInstallationId = getDaemonInstallationId()
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      machineId: 'machine-1', daemonInstallationId, dataEpoch: 2,
    }), { status: 200 }))
    await expect(synchronizeMachinePersonalAuthority({
      serverUrl: 'https://shennian.net/', machineToken: 'machine-token',
      machineId: 'machine-1', fetchImpl: fetchImpl as typeof fetch,
    })).resolves.toEqual({ machineId: 'machine-1', daemonInstallationId, dataEpoch: 2 })
    expect(loadConfig().accountNamespaceId).toBe('a'.repeat(64))
    expect(resolvePersonalSyncV1Path('canonical')).toBe(before)
  })

  it('rejects an authorization response for a different machine', async () => {
    const daemonInstallationId = getDaemonInstallationId()
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      machineId: 'machine-2', daemonInstallationId, dataEpoch: 2,
    }), { status: 200 }))
    await expect(synchronizeMachinePersonalAuthority({
      serverUrl: 'https://shennian.net', machineToken: 'machine-token',
      machineId: 'machine-1', fetchImpl: fetchImpl as typeof fetch,
    })).rejects.toThrow('machine_personal_authority_machine_mismatch')
  })

  it('fails closed when the server reports another daemon installation or epoch', async () => {
    getDaemonInstallationId()
    const base = {
      serverUrl: 'https://shennian.net', machineToken: 'machine-token', machineId: 'machine-1',
    }
    await expect(synchronizeMachinePersonalAuthority({
      ...base,
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({
        machineId: 'machine-1', daemonInstallationId: 'other-daemon', dataEpoch: 2,
      }), { status: 200 })) as typeof fetch,
    })).rejects.toThrow('machine_personal_authority_daemon_mismatch')

    await expect(synchronizeMachinePersonalAuthority({
      ...base,
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({
        machineId: 'machine-1', daemonInstallationId: getDaemonInstallationId(), dataEpoch: 3,
      }), { status: 200 })) as typeof fetch,
    })).rejects.toThrow('machine_personal_authority_epoch_mismatch')
  })
})
