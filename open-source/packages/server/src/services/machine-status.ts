import { prisma } from '../lib/prisma.js'
import { redis } from '../lib/redis.js'
import { connections } from '../relay/connections.js'
import { pubsub } from '../relay/pubsub.js'
import { broadcastRoomEvent } from './room-events.js'
import { parseManagedAgentRuntimeProtection } from './managed-agent-permission-policy.js'
import { syncCancelledPublishedAiRoomMessages } from './published-ai-room-status.js'
import type { SessionSyncCapability, SessionSyncDataEpoch } from '@shennian/wire'

function buildMachineStatusEvent(
  machineId: string,
  online: boolean,
  region?: string,
  cliVersion?: string,
  autoUpgrade?: 'none' | 'patch',
  sync?: {
    protocolVersion: number
    dataEpoch: SessionSyncDataEpoch
    capabilities: SessionSyncCapability[]
    daemonInstallationId: string
    updaterProtocolVersion?: number
  },
  remoteAccessDisabledAt?: Date | string | null,
): string {
  return JSON.stringify({
    type: 'event',
    event: 'machine.status',
    payload: {
      machineId,
      online,
      lastSeen: Date.now(),
      region,
      cliVersion,
      autoUpgrade,
      ...(sync
        ? {
            sessionSyncProtocolVersion: sync.protocolVersion,
            sessionSyncDataEpoch: sync.dataEpoch,
            sessionSyncCapabilities: sync.capabilities,
            daemonInstallationId: sync.daemonInstallationId,
            ...(sync.updaterProtocolVersion != null
              ? { updaterProtocolVersion: sync.updaterProtocolVersion }
              : {}),
          }
        : {}),
      ...(remoteAccessDisabledAt !== undefined
        ? {
            remoteAccessDisabledAt:
              remoteAccessDisabledAt instanceof Date
                ? remoteAccessDisabledAt.toISOString()
                : remoteAccessDisabledAt,
          }
        : {}),
    },
  })
}

function broadcastMachineAccountEvent(machineId: string, userId: string, event: string): void {
  if (pubsub.isActive) {
    // Account-scoped clients can be attached to any Server and may currently be
    // subscribed to another machine. Keep the machine channel as a compatibility
    // path for released clients while the account-scoped stream rolls out.
    pubsub.publishToUser(userId, event)
    pubsub.publishToClient(machineId, event)
    return
  }
  connections.broadcastToClientsOfUser(userId, event)
}

export async function setMachineOnline(
  machineId: string,
  region?: string,
  cliVersion?: string,
  autoUpgrade?: 'none' | 'patch',
  sync?: {
    protocolVersion: number
    dataEpoch: SessionSyncDataEpoch
    capabilities: SessionSyncCapability[]
    daemonInstallationId: string
    updaterProtocolVersion?: number
  },
): Promise<void> {
  const machine = await prisma.machine.update({
    where: { id: machineId },
    data: {
      online: true,
      lastSeen: new Date(),
      remoteAccessDisabledAt: null,
      ...(cliVersion ? { cliVersion } : {}),
      ...(autoUpgrade ? { autoUpgrade } : {}),
      ...(sync
        ? {
            sessionSyncProtocolVersion: sync.protocolVersion,
            sessionSyncDataEpoch: sync.dataEpoch,
            sessionSyncCapabilities: sync.capabilities,
            daemonInstallationId: sync.daemonInstallationId,
          }
        : {}),
    },
  })
  if (region) {
    await redis.set(`machine:${machineId}:region`, region)
  }
  if (machine.userId) {
    const event = buildMachineStatusEvent(
      machineId,
      true,
      region,
      cliVersion,
      autoUpgrade,
      sync,
      null,
    )
    broadcastMachineAccountEvent(machineId, machine.userId, event)
  }
  await broadcastMachineBindingAvailability(machineId)
}

export async function setMachineCliVersion(machineId: string, cliVersion: string): Promise<void> {
  const machine = await prisma.machine.update({
    where: { id: machineId },
    data: { cliVersion },
  })
  if (machine.userId) {
    const event = buildMachineStatusEvent(machineId, machine.online, undefined, cliVersion)
    broadcastMachineAccountEvent(machineId, machine.userId, event)
  }
}

export async function setMachineAutoUpgrade(
  machineId: string,
  autoUpgrade: 'none' | 'patch',
): Promise<void> {
  const machine = await prisma.machine.update({
    where: { id: machineId },
    data: { autoUpgrade },
  })
  if (machine.userId) {
    const event = buildMachineStatusEvent(
      machineId,
      machine.online,
      undefined,
      machine.cliVersion ?? undefined,
      autoUpgrade,
    )
    broadcastMachineAccountEvent(machineId, machine.userId, event)
  }
}

export async function setMachineAgentList(machineId: string, agentList: string[]): Promise<void> {
  const machine = await retryMachineCapabilityWrite(() => prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM Machine WHERE id = ${machineId} FOR UPDATE`
    // Reconnect and discovery update availability, not the Owner's sharing
    // authorization. Cancel stale work after capability changes without
    // requiring the Owner to enable the same share link again.
    const previous = await tx.machine.findUnique({ where: { id: machineId }, select: { agentList: true } })
    const previousList = [...(Array.isArray(previous?.agentList) ? previous.agentList as string[] : [])].sort()
    const nextList = [...agentList].sort()
    const changed = previousList.length !== nextList.length
      || previousList.some((value, index) => value !== nextList[index])
    if (changed) {
      // Legacy daemons only report type names. Their old rich capability data
      // must not remain authoritative after a reconnect that changes the agent list.
      const activeAgents = await tx.agentIdentity.findMany({
        where: { machineId, publication: { status: 'active' } },
        select: { id: true },
      })
      if (activeAgents.length) {
        const agentIds = activeAgents.map((agent) => agent.id)
        await tx.agentDirectMessage.updateMany({
          where: { status: { in: ['pending', 'running'] },
            conversation: { agentIdentityId: { in: agentIds } } },
          data: { status: 'cancelled', claimTokenHash: null, leaseExpiresAt: null },
        })
        await syncCancelledPublishedAiRoomMessages(tx, { agentIdentityId: { in: agentIds } })
      }
    }
    return tx.machine.update({
      where: { id: machineId },
      data: changed ? { agentList, agents: [] } : { agentList },
      select: { userId: true, online: true, cliVersion: true },
    })
  }))
  if (machine.userId) {
    const event = JSON.stringify({
      type: 'event',
      event: 'machine.agents',
      payload: { machineId, agentList },
    })
    broadcastMachineAccountEvent(machineId, machine.userId, event)
  }
}

export async function setMachineAgents(machineId: string, agents: unknown[]): Promise<void> {
  const jsonAgents = JSON.parse(JSON.stringify(agents)) as unknown[]
  const agentList = agents
    .map((agent) => {
      if (!agent || typeof agent !== 'object') return null
      const type = (agent as { type?: unknown }).type
      return typeof type === 'string' ? type : null
    })
    .filter((type): type is string => !!type)
  const machine = await retryMachineCapabilityWrite(() => prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM Machine WHERE id = ${machineId} FOR UPDATE`
    const previous = await tx.machine.findUnique({ where: { id: machineId }, select: { agents: true } })
    const activeAgents = await tx.agentIdentity.findMany({
      where: { machineId, publication: { status: 'active' } },
      select: { id: true, runtimeAdapter: true },
    })
    const changed = activeAgents.filter((agent) => {
      if (!agent.runtimeAdapter) return true
      const oldSnapshot = runtimeSecuritySnapshot(previous?.agents, agent.runtimeAdapter)
      const newSnapshot = runtimeSecuritySnapshot(jsonAgents, agent.runtimeAdapter)
      return !oldSnapshot || !newSnapshot || oldSnapshot !== newSnapshot
    })
    if (changed.length) {
      const agentIds = changed.map((agent) => agent.id)
      await tx.agentDirectMessage.updateMany({
        where: { status: { in: ['pending', 'running'] },
          conversation: { agentIdentityId: { in: agentIds } } },
        data: { status: 'cancelled', claimTokenHash: null, leaseExpiresAt: null },
      })
      await syncCancelledPublishedAiRoomMessages(tx, { agentIdentityId: { in: agentIds } })
    }
    return tx.machine.update({
      where: { id: machineId },
      data: { agents: jsonAgents as string[], agentList },
      select: { userId: true },
    })
  }))
  if (machine.userId) {
    const event = JSON.stringify({
      type: 'event',
      event: 'machine.agents',
      payload: { machineId, agentList, agents },
    })
    broadcastMachineAccountEvent(machineId, machine.userId, event)
  }
}

async function retryMachineCapabilityWrite<T>(write: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await write() }
    catch (error) {
      const conflict = error && typeof error === 'object' && 'code' in error
        && error.code === 'P2034'
      if (!conflict || attempt === 2) throw error
    }
  }
  throw new Error('machine_capability_update_unavailable')
}

function runtimeSecuritySnapshot(agents: unknown, runtimeAdapter: string): string | null {
  if (!Array.isArray(agents)) return null
  const runtime = agents.find((agent) => agent && typeof agent === 'object'
    && !Array.isArray(agent) && (agent as Record<string, unknown>).type === runtimeAdapter)
  if (!runtime) return null
  const info = runtime as Record<string, unknown>
  const protection = parseManagedAgentRuntimeProtection(info.managedAgentProtection)
  if (!protection) return null
  return JSON.stringify({
    supportsManagedAgent: info.supportsManagedAgent === true,
    supportedAgentExecutionModes: Array.isArray(info.supportedAgentExecutionModes)
      ? info.supportedAgentExecutionModes.filter((mode): mode is string => typeof mode === 'string').sort()
      : [],
    authState: info.authState,
    level: protection.level,
    runtimeVersion: protection.runtimeVersion,
    platform: protection.platform,
    executableFingerprint: protection.executableFingerprint,
    unsupportedCapabilities: [...protection.unsupportedCapabilities].sort(),
    capabilityMatrix: protection.capabilityMatrix,
  })
}

export async function setMachineOffline(machineId: string): Promise<void> {
  const machine = await prisma.machine.update({
    where: { id: machineId },
    data: { online: false, lastSeen: new Date() },
  })
  await redis.del(`machine:${machineId}:region`)
  if (machine.userId) {
    const event = buildMachineStatusEvent(
      machineId,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      machine.remoteAccessDisabledAt,
    )
    broadcastMachineAccountEvent(machineId, machine.userId, event)
  }
  await broadcastMachineBindingAvailability(machineId)
}

export async function setMachineRemoteAccessDisabled(machineId: string): Promise<string> {
  const disabledAt = new Date()
  const machine = await prisma.machine.update({
    where: { id: machineId },
    data: { online: false, lastSeen: disabledAt, remoteAccessDisabledAt: disabledAt },
  })
  await redis.del(`machine:${machineId}:region`)
  if (machine.userId) {
    const event = buildMachineStatusEvent(
      machineId,
      false,
      undefined,
      machine.cliVersion ?? undefined,
      machine.autoUpgrade === 'patch' ? 'patch' : 'none',
      undefined,
      disabledAt,
    )
    broadcastMachineAccountEvent(machineId, machine.userId, event)
  }
  await broadcastMachineBindingAvailability(machineId)
  return disabledAt.toISOString()
}

async function broadcastMachineBindingAvailability(machineId: string): Promise<void> {
  const bindings = await prisma.roomBinding.findMany({
    where: {
      machineId,
      status: { in: ['active', 'paused', 'detached'] },
      room: { status: 'active' },
      agentMembership: { status: 'active' },
    },
    select: { id: true, roomId: true },
  })
  await Promise.all(
    bindings.map((binding) =>
      broadcastRoomEvent(binding.roomId, {
        event: 'room.binding.updated',
        roomId: binding.roomId,
        entityId: binding.id,
      }),
    ),
  )
}
