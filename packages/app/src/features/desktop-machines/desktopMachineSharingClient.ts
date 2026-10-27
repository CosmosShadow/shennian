// @arch docs/features/desktop-local-first-client.md#33-进程职责
// @test ../../__tests__/desktop-machine-sharing.test.ts

import type { MachineGrant } from '@shennian/wire'
import type { DesktopMachineSharingClient, DesktopMachineSharingInvite } from './desktopMachineSharingModel'

type Operation = 'machine.grants.list' | 'machine.grant.create' | 'machine.grant.revoke'
type Result =
  | { ok: true; value: unknown }
  | { ok: false; error: { code: string; message: string; retryable: boolean; action?: 'retry' | 'sign_in' } }
type Bridge = {
  execute(command: { requestId: string; operation: Operation; input: Record<string, unknown> }): Promise<Result>
}
type DesktopWindow = typeof globalThis & { shennianDesktop?: { account?: Bridge } }

let sequence = 0

export class DesktopMachineSharingError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly action?: 'retry' | 'sign_in',
  ) {
    super(message)
    this.name = 'DesktopMachineSharingError'
  }
}

/** Desktop-only machine sharing port. Authorization and transport stay in Electron main. */
export const desktopMachineSharingClient: DesktopMachineSharingClient = {
  async list(machineId) {
    const grants = object(await execute('machine.grants.list', { machineId })).grants
    if (!Array.isArray(grants)) invalidOutput()
    return grants.map(grant)
  },
  async create(machineId, expiresAt) {
    return invite(await execute('machine.grant.create', {
      machineId,
      ...(expiresAt === undefined ? {} : { expiresAt }),
    }))
  },
  async revoke(machineId, grantId) {
    await execute('machine.grant.revoke', { machineId, grantId })
  },
}

function bridge(): Bridge {
  const value = (globalThis as DesktopWindow).shennianDesktop?.account
  if (!value || typeof value.execute !== 'function') {
    throw new DesktopMachineSharingError('BRIDGE_UNAVAILABLE', 'Desktop machine sharing is unavailable.', false)
  }
  return value
}

async function execute(operation: Operation, input: Record<string, unknown>): Promise<unknown> {
  const result = await bridge().execute({
    requestId: `desktop-machine-sharing-${++sequence}`,
    operation,
    input,
  })
  if (result.ok) return result.value
  throw new DesktopMachineSharingError(result.error.code, result.error.message, result.error.retryable, result.error.action)
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidOutput()
  return value as Record<string, unknown>
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function grant(value: unknown): MachineGrant {
  const item = object(value)
  if (
    typeof item.id !== 'string' || !item.id ||
    !nullableString(item.granteeId) || !nullableString(item.granteeName) ||
    !['view', 'use', 'full', 'admin'].includes(String(item.permission)) ||
    !nullableString(item.expiresAt) || !nullableString(item.revokedAt) ||
    typeof item.createdAt !== 'string' || typeof item.redeemed !== 'boolean' ||
    (item.granteeAvatar !== undefined && item.granteeAvatar !== null && !validAvatar(item.granteeAvatar))
  ) invalidOutput()
  return item as MachineGrant
}

function validAvatar(value: unknown): boolean {
  const item = object(value)
  return typeof item.version === 'string' && typeof item.thumbUrl === 'string' && typeof item.originalUrl === 'string'
}

function invite(value: unknown): DesktopMachineSharingInvite {
  const item = object(value)
  if (
    typeof item.grantId !== 'string' || !item.grantId ||
    typeof item.inviteUrl !== 'string' || !item.inviteUrl ||
    !nullableString(item.expiresAt)
  ) invalidOutput()
  return item as DesktopMachineSharingInvite
}

function invalidOutput(): never {
  throw new DesktopMachineSharingError('INVALID_OUTPUT', 'Desktop machine sharing response is invalid.', false)
}
