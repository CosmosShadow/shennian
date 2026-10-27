// @covers src/room/host-session-observations.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { RoomHostSessionObservationStore } from '../room/host-session-observations.js'

const roots: string[] = []
const hash = (char: string) => char.repeat(64)

function createStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-host-observation-'))
  roots.push(root)
  return new RoomHostSessionObservationStore(path.join(root, 'runtime', 'observations.json'))
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('RoomHostSessionObservationStore', () => {
  it('tracks WorkBuddy active, idle, closed and resumed epochs without a fake NianSession', () => {
    const store = createStore()
    const base = {
      machineId: 'machine_1',
      runtimeAdapter: 'workbuddy' as const,
      sourceSessionKey: 'workbuddy-session-1',
      hostContextHash: hash('a'),
      workspaceHash: hash('b'),
      workspacePath: '/Users/private/project',
    }
    const activeAt = new Date('2026-08-23T10:00:00.000Z')
    const idleAt = new Date('2026-08-23T10:00:01.000Z')
    expect(store.observe({ ...base, lifecycleState: 'active', eventName: 'SessionStart', now: activeAt })).toMatchObject({
      lifecycleState: 'active', registrationEpoch: 1, lastActiveAt: activeAt.toISOString(), lastIdleAt: null,
    })
    expect(store.observe({ ...base, lifecycleState: 'idle', eventName: 'Stop', now: idleAt })).toMatchObject({
      lifecycleState: 'idle', registrationEpoch: 1,
      lastActiveAt: activeAt.toISOString(), lastIdleAt: idleAt.toISOString(),
    })
    expect(store.observe({ ...base, lifecycleState: 'closed', eventName: 'SessionEnd' })).toMatchObject({
      lifecycleState: 'closed', registrationEpoch: 1,
    })
    expect(store.observe({ ...base, lifecycleState: 'idle', eventName: 'Stop' }).lifecycleState).toBe('closed')
    expect(store.observe({ ...base, lifecycleState: 'active', eventName: 'SessionStart' })).toMatchObject({
      lifecycleState: 'active', registrationEpoch: 2, closedAt: null, lastIdleAt: null,
    })
    const persisted = fs.readFileSync(store.filePath, 'utf8')
    expect(persisted).not.toContain('nianSessionId')
    expect(persisted).not.toContain('transcript')
    expect(store.list()[0]?.workspacePath).toBe('/Users/private/project')
  })

  it('restores observations with private filesystem permissions', () => {
    const store = createStore()
    store.observe({
      machineId: 'machine_1', runtimeAdapter: 'workbuddy', sourceSessionKey: 'session_1',
      hostContextHash: hash('c'), lifecycleState: 'active', eventName: 'SessionStart',
    })
    const restored = new RoomHostSessionObservationStore(store.filePath)
    expect(restored.list()).toHaveLength(1)
    if (process.platform !== 'win32') {
      expect(fs.statSync(path.dirname(store.filePath)).mode & 0o777).toBe(0o700)
      expect(fs.statSync(store.filePath).mode & 0o777).toBe(0o600)
    }
  })

  it('upgrades legacy observations without transition timestamps', () => {
    const store = createStore()
    const observed = store.observe({
      machineId: 'machine_1', runtimeAdapter: 'workbuddy', sourceSessionKey: 'session_legacy',
      hostContextHash: hash('d'), lifecycleState: 'idle', eventName: 'Stop',
      now: new Date('2026-08-23T11:00:00.000Z'),
    })
    const value = JSON.parse(fs.readFileSync(store.filePath, 'utf8'))
    delete value.records[observed.observationKey].lastActiveAt
    delete value.records[observed.observationKey].lastIdleAt
    fs.writeFileSync(store.filePath, `${JSON.stringify(value)}\n`, { mode: 0o600 })

    expect(new RoomHostSessionObservationStore(store.filePath).list()[0]).toMatchObject({
      lastActiveAt: null,
      lastIdleAt: '2026-08-23T11:00:00.000Z',
    })
  })

  it('rejects unsafe symbolic-link storage', () => {
    if (process.platform === 'win32') return
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-host-observation-link-'))
    roots.push(root)
    const target = path.join(root, 'target.json')
    fs.writeFileSync(target, JSON.stringify({ schemaVersion: 1, records: {} }))
    const link = path.join(root, 'observations.json')
    fs.symlinkSync(target, link)
    expect(() => new RoomHostSessionObservationStore(link)).toThrowError(expect.objectContaining({
      code: 'unsafe_observation_store',
    }))
  })
})
