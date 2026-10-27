// @covers src/personal-sync/epoch.ts
// @covers src/personal-sync/identity.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let home: string

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-epoch-'))
  vi.stubEnv('SHENNIAN_HOME', home)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
  fs.rmSync(home, { recursive: true, force: true })
})

describe('personal data epoch hard cut', () => {
  it('preserves installation, pairing and Room data while deleting legacy personal roots', async () => {
    const legacy = path.join(home, 'personal-sync-v1')
    fs.mkdirSync(path.join(legacy, 'accounts', 'old-account', 'canonical'), { recursive: true })
    fs.writeFileSync(path.join(legacy, 'accounts', 'old-account', 'canonical', 'old'), 'old')
    fs.writeFileSync(path.join(legacy, 'installation.json'), JSON.stringify({
      schemaVersion: 1, daemonInstallationId: 'stable-installation', createdAt: '2026-01-01T00:00:00.000Z',
    }))
    const oldWorkDir = path.join(home, 'workspace')
    fs.mkdirSync(path.join(oldWorkDir, '.uploads', '.staging', 'transfer-1'), { recursive: true })
    fs.writeFileSync(
      path.join(legacy, 'accounts', 'old-account', 'session-index.json'),
      JSON.stringify({ old: { workDir: oldWorkDir } }),
    )
    fs.mkdirSync(path.join(home, 'canonical'), { recursive: true })
    fs.writeFileSync(path.join(home, 'session-index.json'), '{}')
    fs.mkdirSync(path.join(home, 'rooms'), { recursive: true })
    fs.writeFileSync(path.join(home, 'rooms', 'room-state.json'), 'keep')
    fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ machineToken: 'keep-token' }))
    const providerHistory = path.join(home, 'provider-rollout.jsonl')
    fs.writeFileSync(providerHistory, 'keep-provider')

    const { ensurePersonalDataEpoch } = await import('../personal-sync/epoch.js')
    const marker = ensurePersonalDataEpoch(new Date('2026-09-03T00:00:00.000Z'))

    expect(marker).toEqual({
      schemaVersion: 1, dataEpoch: 2, daemonInstallationId: 'stable-installation',
      epochStartedAt: '2026-09-03T00:00:00.000Z',
    })
    expect(fs.existsSync(legacy)).toBe(false)
    expect(fs.existsSync(path.join(home, 'canonical'))).toBe(false)
    expect(fs.existsSync(path.join(home, 'session-index.json'))).toBe(false)
    expect(fs.existsSync(path.join(oldWorkDir, '.uploads', '.staging'))).toBe(false)
    expect(fs.readFileSync(path.join(home, 'rooms', 'room-state.json'), 'utf8')).toBe('keep')
    expect(fs.readFileSync(providerHistory, 'utf8')).toBe('keep-provider')
    expect(JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8'))).toEqual({ machineToken: 'keep-token' })
    expect(fs.existsSync(path.join(home, 'installation.json'))).toBe(true)
    const scanner = await import('../native-fusion/state.js')
    expect(scanner.loadNativeScannerState().fusionEpochMs)
      .toBe(Date.parse('2026-09-03T00:00:00.000Z'))
  })

  it('resumes partial cleanup with the original epochStartedAt', async () => {
    fs.mkdirSync(path.join(home, 'personal-sync', '2', 'canonical'), { recursive: true })
    fs.writeFileSync(path.join(home, 'personal-sync', '2', 'canonical', 'partial'), 'partial')
    fs.writeFileSync(path.join(home, 'personal-sync', 'migration.json'), JSON.stringify({
      schemaVersion: 1, targetEpoch: 2, daemonInstallationId: 'install-1',
      epochStartedAt: '2026-09-03T01:00:00.000Z', phase: 'cleaning',
    }))
    fs.writeFileSync(path.join(home, 'installation.json'), JSON.stringify({
      schemaVersion: 1, daemonInstallationId: 'install-1', createdAt: '2026-01-01T00:00:00.000Z',
    }))
    const { ensurePersonalDataEpoch } = await import('../personal-sync/epoch.js')
    const marker = ensurePersonalDataEpoch(new Date('2026-09-04T00:00:00.000Z'))
    expect(marker.epochStartedAt).toBe('2026-09-03T01:00:00.000Z')
    expect(fs.existsSync(path.join(home, 'personal-sync', '2', 'canonical', 'partial'))).toBe(false)
    expect(fs.existsSync(path.join(home, 'personal-sync', 'migration.json'))).toBe(false)
  })

  it('fails closed on a future epoch without deleting it', async () => {
    fs.mkdirSync(path.join(home, 'personal-sync', '3'), { recursive: true })
    fs.writeFileSync(path.join(home, 'personal-sync', '3', 'future'), 'future')
    const { ensurePersonalDataEpoch, FuturePersonalDataEpochError } = await import('../personal-sync/epoch.js')
    expect(() => ensurePersonalDataEpoch()).toThrow(FuturePersonalDataEpochError)
    expect(fs.readFileSync(path.join(home, 'personal-sync', '3', 'future'), 'utf8')).toBe('future')
  })

  it('rejects missing, partial and mismatched personal identities outside unit-fixture mode', async () => {
    vi.stubEnv('VITEST', 'false')
    const {
      assertPersonalSyncIdentity,
      ensurePersonalDataEpoch,
      getPersonalSyncIdentity,
    } = await import('../personal-sync/epoch.js')
    const marker = ensurePersonalDataEpoch()
    const identity = getPersonalSyncIdentity(marker.daemonInstallationId)

    expect(() => assertPersonalSyncIdentity({})).toThrow('personal_sync_identity_mismatch')
    expect(() => assertPersonalSyncIdentity({ protocolVersion: identity.protocolVersion }))
      .toThrow('personal_sync_identity_mismatch')
    expect(() => assertPersonalSyncIdentity({ ...identity, daemonInstallationId: 'other-installation' }))
      .toThrow('personal_sync_identity_mismatch')
    expect(() => assertPersonalSyncIdentity(identity)).not.toThrow()
  })
})
