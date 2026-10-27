// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/managed-room-context.test.ts

import crypto from 'node:crypto'
import type { RoomSessionRegistry } from './session-registry.js'

export const MANAGED_ROOM_CONTEXT_ENV = 'SHENNIAN_MANAGED_ROOM_CONTEXT'

export type ManagedRoomAction = 'status' | 'read' | 'send' | 'attachment.get' | 'pause'

type ManagedRoomGrant = {
  tokenHash: string
  registryKey: string
  registrationEpoch: number
  bindingId: string
  roomId: string
  credentialHash: string
  allowedActions: ReadonlySet<ManagedRoomAction>
  /**
   * Whether Workers started under this grant inherit its Room `send` origin.
   * Owner private turns may publish for themselves but must not let a private
   * Worker task later publish on the Room without a fresh Owner request.
   */
  propagateWorkerRoomOrigin: boolean
  activationCauseMessageId?: string
}

export class ManagedRoomContextError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
    this.name = 'ManagedRoomContextError'
  }
}

const MAX_REVOKED_TOMBSTONES = 256

/**
 * Daemon-memory-only authority. A daemon restart drops every grant. The opaque
 * token is safe to inject into the exact child process, but is never persisted
 * or included in a prompt, command argument, transcript, Room message or log.
 *
 * A grant has no time-based expiry: the Owner created the managed Agent on
 * their own machine, so it stays valid until its Session is closed, it is
 * replaced by the next Turn's grant, or the Binding/Membership/credential it
 * was issued for changes. Every action still re-validates the current state.
 */
export class ManagedRoomContextAuthority {
  private readonly grants = new Map<string, ManagedRoomGrant>()
  // Grants dropped because the Binding changed keep a tiny tombstone so a later
  // retry reports `revoked` instead of the generic "grant not found" expiry.
  private readonly revoked = new Set<string>()

  constructor(private readonly registry: RoomSessionRegistry) {}

  issue(input: {
    registryKey: string
    machineCredential: string
    allowedActions?: ManagedRoomAction[]
    propagateWorkerRoomOrigin?: boolean
    activationCauseMessageId?: string
  }): string {
    const registration = this.registry.getByRegistryKey(input.registryKey)
    if (!registration?.binding || registration.lifecycleState === 'closed') {
      throw new ManagedRoomContextError('managed_room_context_unavailable', 'Managed Room context is unavailable.')
    }
    if (registration.binding.status !== 'active' && registration.binding.status !== 'paused') {
      throw new ManagedRoomContextError('managed_room_binding_unavailable', 'Managed Room binding is unavailable.')
    }
    if (!registration.binding.agentMembershipId) {
      throw new ManagedRoomContextError('managed_room_membership_unavailable', 'Managed Room membership is unavailable.')
    }
    const credential = input.machineCredential.trim()
    if (!credential) throw new ManagedRoomContextError('machine_not_authorized', 'This machine is not authorized yet.')
    const token = `mrc_${crypto.randomBytes(32).toString('base64url')}`
    const tokenHash = hash(token)
    this.grants.set(tokenHash, {
      tokenHash,
      registryKey: registration.registryKey,
      registrationEpoch: registration.registrationEpoch,
      bindingId: registration.binding.bindingId,
      roomId: registration.binding.roomId,
      credentialHash: hash(credential),
      allowedActions: new Set(input.allowedActions ?? ['status', 'read', 'send', 'attachment.get', 'pause']),
      propagateWorkerRoomOrigin: input.propagateWorkerRoomOrigin ?? true,
      activationCauseMessageId: input.activationCauseMessageId,
    })
    return token
  }

  resolve(input: { token: string; action: ManagedRoomAction | 'manager'; machineCredential: string }) {
    const tokenHash = hash(input.token)
    const grant = this.grants.get(tokenHash)
    if (!grant) {
      if (this.revoked.has(tokenHash)) {
        throw new ManagedRoomContextError('managed_room_context_revoked', 'Managed Room context was revoked.')
      }
      throw new ManagedRoomContextError('managed_room_context_expired', 'Managed Room context expired.')
    }
    if (!safeEqual(grant.credentialHash, hash(input.machineCredential))) {
      throw new ManagedRoomContextError('managed_room_context_invalid', 'Managed Room context is invalid.')
    }
    // 'status' reveals no Room content or send capability, only that this grant is still
    // bound and alive; every grant (including send-only) implicitly carries it so a runtime
    // adapter's pre-turn liveness check never has to match the turn's actual allowed actions.
    if (input.action !== 'manager' && input.action !== 'status' && !grant.allowedActions.has(input.action)) {
      throw new ManagedRoomContextError('managed_room_action_forbidden', 'This action is not allowed in the managed Room context.')
    }
    const registration = this.registry.getByRegistryKey(grant.registryKey)
    const binding = registration?.binding
    if (
      !registration || !binding || registration.registrationEpoch !== grant.registrationEpoch ||
      binding.bindingId !== grant.bindingId || binding.roomId !== grant.roomId ||
      registration.lifecycleState === 'closed' ||
      (binding.status !== 'active' && binding.status !== 'paused') ||
      !binding.agentMembershipId
    ) {
      this.grants.delete(tokenHash)
      this.rememberRevoked(tokenHash)
      throw new ManagedRoomContextError('managed_room_context_revoked', 'Managed Room context was revoked.')
    }
    return { grant, registration, binding }
  }

  revokeToken(token: string): void {
    this.grants.delete(hash(token))
  }

  revokeSession(registryKey: string): void {
    for (const [key, grant] of this.grants) if (grant.registryKey === registryKey) this.grants.delete(key)
  }

  private rememberRevoked(tokenHash: string): void {
    this.revoked.add(tokenHash)
    if (this.revoked.size > MAX_REVOKED_TOMBSTONES) {
      const oldest = this.revoked.values().next().value
      if (oldest !== undefined) this.revoked.delete(oldest)
    }
  }
}

function hash(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex')
}

function safeEqual(left: string, right: string): boolean {
  return crypto.timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'))
}
