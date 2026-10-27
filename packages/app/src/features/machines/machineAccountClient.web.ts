// @arch docs/features/desktop-local-first-client.md#33-进程职责
// @test src/__tests__/machine-account-client-web.test.ts

import type { Machine, MachineGrant, NianProject, NianSession } from '@shennian/wire'
import type {
  MachineAccountClient,
  MachineAgentCatalogEntry,
  MachineGrantInvite,
  MachineGrantPreview,
  MachineSessionCreateInput,
} from './machineAccountClient.types'

type MachineOperation =
  | 'machine.list'
  | 'machine.pair.claim'
  | 'machine.update'
  | 'machine.remove'
  | 'machine.grants.list'
  | 'machine.grant.create'
  | 'machine.grant.revoke'
  | 'machine.grant.preview'
  | 'machine.grant.redeem'
  | 'machine.agentCatalog.list'
  | 'project.create'
  | 'session.create'
  | 'session.delete'

type DesktopResult =
  | { ok: true; value: unknown }
  | {
      ok: false
      error: {
        code: string
        message: string
        retryable: boolean
        action?: 'retry' | 'sign_in'
      }
    }

type DesktopMachineAccountBridge = {
  execute(command: {
    requestId: string
    operation: MachineOperation
    input: Record<string, unknown>
  }): Promise<DesktopResult>
}

type DesktopMachineWindow = typeof globalThis & {
  shennianDesktop?: { account?: DesktopMachineAccountBridge }
}

let requestSequence = 0

export class DesktopMachineAccountError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly action?: 'retry' | 'sign_in',
  ) {
    super(message)
    this.name = 'DesktopMachineAccountError'
  }
}

export const machineAccountClient: MachineAccountClient = {
  async listMachines() {
    return requireArrayField(await execute('machine.list', {}), 'machines', requireMachine)
  },
  async claimPair(pairToken) {
    const value = await execute('machine.pair.claim', { pairToken })
    const result = value && typeof value === 'object' ? value as Record<string, unknown> : {}
    const machine = result.machine && typeof result.machine === 'object' ? result.machine as { id?: unknown } : null
    const id = machine?.id ?? result.machineId
    return { machineId: typeof id === 'string' ? id : undefined }
  },
  async updateMachine(machineId, name) {
    await execute('machine.update', { machineId, name })
  },
  async removeMachine(machineId) {
    await execute('machine.remove', { machineId })
  },
  async listGrants(machineId) {
    return requireArrayField(
      await execute('machine.grants.list', { machineId }),
      'grants',
      requireGrant,
    )
  },
  async createGrant(machineId, expiresAt) {
    return requireGrantInvite(
      await execute('machine.grant.create', {
        machineId,
        ...(expiresAt === undefined ? {} : { expiresAt }),
      }),
    )
  },
  async revokeGrant(machineId, grantId) {
    await execute('machine.grant.revoke', { machineId, grantId })
  },
  async previewGrant(shareToken) {
    return requireGrantPreview(await execute('machine.grant.preview', { shareToken }))
  },
  async redeemGrant(shareToken) {
    return requireString(
      requireObject(await execute('machine.grant.redeem', { shareToken })).machineId,
    )
  },
  async listAgentCatalog() {
    return requireArrayField(
      await execute('machine.agentCatalog.list', {}),
      'agents',
      requireCatalogEntry,
    )
  },
  async createProject(machineId, workDir) {
    return requireProject(
      requireObject(await execute('project.create', { machineId, workDir })).project,
    )
  },
  async createSession(input) {
    return requireSession(
      requireObject(await execute('session.create', toSessionInput(input))).session,
    )
  },
  async deleteSession(sessionId) {
    await execute('session.delete', { sessionId, nativeCleanupPolicy: 'none' })
  },
}

function requireBridge(): DesktopMachineAccountBridge {
  const bridge = (globalThis as DesktopMachineWindow).shennianDesktop?.account
  if (!bridge || typeof bridge.execute !== 'function') {
    throw new DesktopMachineAccountError(
      'BRIDGE_UNAVAILABLE',
      'Desktop machine account bridge is unavailable.',
      false,
    )
  }
  return bridge
}

async function execute(
  operation: MachineOperation,
  input: Record<string, unknown>,
): Promise<unknown> {
  const requestId = `machine-account-${Date.now()}-${++requestSequence}`
  const result = await requireBridge().execute({ requestId, operation, input })
  if (result.ok) return result.value
  throw new DesktopMachineAccountError(
    result.error.code,
    result.error.message,
    result.error.retryable,
    result.error.action,
  )
}

function toSessionInput(input: MachineSessionCreateInput): Record<string, unknown> {
  const { machineId, agentType, workDir, ...settings } = input
  return {
    machineId,
    agentType,
    workDir,
    ...(Object.keys(settings).length ? { settings } : {}),
  }
}

function requireObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidOutput()
  return value as Record<string, unknown>
}

function requireArrayField<T>(value: unknown, field: string, validate: (item: unknown) => T): T[] {
  const items = requireObject(value)[field]
  if (!Array.isArray(items)) throw invalidOutput()
  return items.map(validate)
}

function requireMachine(value: unknown): Machine {
  const machine = requireObject(value)
  if (
    typeof machine.id !== 'string' ||
    typeof machine.name !== 'string' ||
    typeof machine.os !== 'string' ||
    !Array.isArray(machine.agentList)
  ) {
    throw invalidOutput()
  }
  return machine as Machine
}

function requireGrant(value: unknown): MachineGrant {
  const grant = requireObject(value)
  if (typeof grant.id !== 'string' || typeof grant.permission !== 'string') throw invalidOutput()
  return grant as MachineGrant
}

function requireGrantInvite(value: unknown): MachineGrantInvite {
  const invite = requireObject(value)
  if (
    typeof invite.grantId !== 'string' ||
    typeof invite.inviteUrl !== 'string' ||
    (invite.expiresAt !== null && typeof invite.expiresAt !== 'string')
  ) {
    throw invalidOutput()
  }
  return invite as MachineGrantInvite
}

function requireGrantPreview(value: unknown): MachineGrantPreview {
  const preview = requireObject(value)
  if (
    typeof preview.machineName !== 'string' ||
    typeof preview.ownerName !== 'string' ||
    (preview.expiresAt !== null && typeof preview.expiresAt !== 'string')
  ) {
    throw invalidOutput()
  }
  return preview as MachineGrantPreview
}

function requireCatalogEntry(value: unknown): MachineAgentCatalogEntry {
  const entry = requireObject(value)
  if (typeof entry.id !== 'string' || typeof entry.name !== 'string') throw invalidOutput()
  if (entry.website !== undefined && typeof entry.website !== 'string') throw invalidOutput()
  if (
    entry.platforms !== undefined &&
    (!Array.isArray(entry.platforms) || entry.platforms.some((item) => typeof item !== 'string'))
  ) {
    throw invalidOutput()
  }
  return entry as MachineAgentCatalogEntry
}

function requireProject(value: unknown): NianProject {
  const project = requireObject(value)
  if (
    typeof project.id !== 'string' ||
    typeof project.machineId !== 'string' ||
    typeof project.workDir !== 'string'
  ) {
    throw invalidOutput()
  }
  return project as NianProject
}

function requireSession(value: unknown): NianSession {
  const session = requireObject(value)
  if (typeof session.id !== 'string') throw invalidOutput()
  return session as NianSession
}

function requireString(value: unknown): string {
  if (typeof value !== 'string' || !value) throw invalidOutput()
  return value
}

function invalidOutput(): DesktopMachineAccountError {
  return new DesktopMachineAccountError(
    'INVALID_OUTPUT',
    'Desktop machine response is invalid.',
    false,
  )
}
