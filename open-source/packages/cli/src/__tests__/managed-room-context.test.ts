// @covers open-source/packages/cli/src/room/managed-context.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ManagedRoomContextAuthority } from '../room/managed-context.js'
import { RoomSessionRegistry } from '../room/session-registry.js'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })

describe('ManagedRoomContextAuthority', () => {
  it('binds an opaque grant to the exact registration, credential and action without a time limit', () => {
    vi.useFakeTimers()
    try {
      const { registry, key } = boundRegistry()
      const authority = new ManagedRoomContextAuthority(registry)
      const token = authority.issue({
        registryKey: key,
        machineCredential: 'machine-secret',
        activationCauseMessageId: 'message_cause',
      })

      expect(token).toMatch(/^mrc_[A-Za-z0-9_-]{43}$/)
      const resolved = authority.resolve({ token, action: 'read', machineCredential: 'machine-secret' })
      expect(resolved.binding.roomId).toBe('room_1')
      expect(resolved.grant.activationCauseMessageId).toBe('message_cause')
      expect(() => authority.resolve({ token, action: 'read', machineCredential: 'wrong' })).toThrowError(/invalid/i)
      // A long task, tool call or approval wait never invalidates a valid grant.
      vi.advanceTimersByTime(48 * 60 * 60_000)
      expect(authority.resolve({ token, action: 'send', machineCredential: 'machine-secret' }).binding.roomId)
        .toBe('room_1')
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports revoked, not expired, when a retry reuses a token dropped for a Binding change', () => {
    const { registry, key } = boundRegistry()
    const authority = new ManagedRoomContextAuthority(registry)
    const token = authority.issue({ registryKey: key, machineCredential: 'secret' })
    registry.detachBinding(key)
    expect(() => authority.resolve({ token, action: 'send', machineCredential: 'secret' })).toThrowError(/revoked/i)
    expect(() => authority.resolve({ token, action: 'send', machineCredential: 'secret' })).toThrowError(/revoked/i)
  })

  it('fails closed after detach, close, re-registration, explicit revoke, or daemon restart', () => {
    const { registry, key } = boundRegistry()
    const first = new ManagedRoomContextAuthority(registry)
    const token = first.issue({ registryKey: key, machineCredential: 'secret' })
    registry.detachBinding(key)
    expect(() => first.resolve({ token, action: 'send', machineCredential: 'secret' })).toThrowError(/revoked/i)

    const restarted = new ManagedRoomContextAuthority(registry)
    expect(() => restarted.resolve({ token, action: 'status', machineCredential: 'secret' })).toThrowError(/expired/i)
  })

  it('authorizes Manager operations independently while enforcing a send-only Room grant', () => {
    const { registry, key } = boundRegistry()
    const authority = new ManagedRoomContextAuthority(registry)
    const token = authority.issue({
      registryKey: key,
      machineCredential: 'secret',
      allowedActions: ['send'],
    })

    expect(authority.resolve({ token, action: 'manager', machineCredential: 'secret' }).registration.nianSessionId)
      .toBe('nian_1')
    expect(authority.resolve({ token, action: 'send', machineCredential: 'secret' }).binding.roomId)
      .toBe('room_1')
    expect(() => authority.resolve({ token, action: 'read', machineCredential: 'secret' }))
      .toThrowError(/not allowed/i)
  })

  it('always permits status as a liveness check, even for a send-only grant', () => {
    const { registry, key } = boundRegistry()
    const authority = new ManagedRoomContextAuthority(registry)
    const token = authority.issue({ registryKey: key, machineCredential: 'secret', allowedActions: ['send'] })

    expect(authority.resolve({ token, action: 'status', machineCredential: 'secret' }).binding.roomId)
      .toBe('room_1')
  })

  it('propagates Worker Room origin by default and lets a private grant opt out', () => {
    const { registry, key } = boundRegistry()
    const authority = new ManagedRoomContextAuthority(registry)
    const normal = authority.issue({ registryKey: key, machineCredential: 'secret', allowedActions: ['send'] })
    const ownerPrivate = authority.issue({
      registryKey: key,
      machineCredential: 'secret',
      allowedActions: ['send'],
      propagateWorkerRoomOrigin: false,
    })

    expect(authority.resolve({ token: normal, action: 'manager', machineCredential: 'secret' }).grant.propagateWorkerRoomOrigin)
      .toBe(true)
    expect(authority.resolve({ token: ownerPrivate, action: 'send', machineCredential: 'secret' }).grant.propagateWorkerRoomOrigin)
      .toBe(false)
  })

  it('revokes a token when the same registration is rebound after issue', () => {
    const { registry, key } = boundRegistry()
    const authority = new ManagedRoomContextAuthority(registry)
    const token = authority.issue({ registryKey: key, machineCredential: 'secret' })
    registry.detachBinding(key)
    registry.setBinding({
      registryKey: key, bindingId: 'binding_2', roomId: 'room_2',
      agentIdentityId: 'agent_2', agentMembershipId: 'membership_2', status: 'active',
    })
    expect(() => authority.resolve({ token, action: 'send', machineCredential: 'secret' }))
      .toThrowError(/revoked/i)
  })
})

function boundRegistry() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-managed-context-'))
  roots.push(root)
  const registry = new RoomSessionRegistry(path.join(root, 'registry.json'))
  const registration = registry.register({
    machineId: 'machine_1', runtimeAdapter: 'codex', sourceSessionKey: 'native_1',
    nianSessionId: 'nian_1', hostProcessIdentity: 'daemon:one',
    capabilities: {
      canIdentifySession: true, canBindAutomatically: true, canOpenEmbeddedRoomPage: false,
      canResumeIdleSession: true, canActivateWhileHostOpen: true,
    },
  })
  registry.setBinding({
    registryKey: registration.registryKey, bindingId: 'binding_1', roomId: 'room_1',
    agentIdentityId: 'agent_1', agentMembershipId: 'membership_1', status: 'active',
  })
  return { registry, key: registration.registryKey }
}
