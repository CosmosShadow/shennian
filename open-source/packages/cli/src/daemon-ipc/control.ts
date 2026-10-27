// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/daemon-control-ipc.test.ts

import fs from 'node:fs'
import type { DetectedAgent } from '../agents/detect.js'
import type { DaemonStatus } from '../commands/daemon.js'
import type { JsonValue } from './json.js'
import type { DaemonIpcHandler } from './server.js'
import { getAcpLocalMetrics } from '../agents/acp/metrics.js'

export const DAEMON_CONTROL_CAPABILITIES = [
  'protocol.info',
  'daemon.status',
  'daemon.shutdown',
  'agent.list',
  'agent.discover',
  'agent.check',
  'room.agent.bind-managed',
  'steward.say',
  'agent.auth.completed',
  'log.read',
  'upgrade.start',
  'upgrade.prepare-external',
  'upgrade.cancel-external',
] as const

const DEFAULT_LOG_PAGE_BYTES = 32 * 1024
const MAX_LOG_PAGE_BYTES = 64 * 1024

export function createDaemonControlHandlers(input: {
  daemonVersion: string
  protocolVersion: number
  getStatus: () => DaemonStatus
  requestShutdown?: () => void
  getAgents: () => DetectedAgent[]
  startUpgrade?: (params: JsonValue | undefined) => Promise<JsonValue>
  prepareExternalUpgrade?: (params: JsonValue | undefined) => Promise<JsonValue> | JsonValue
  cancelExternalUpgrade?: () => Promise<JsonValue> | JsonValue
  completeAgentAuthentication?: (agentType: string) => Promise<boolean>
  bindManagedRoom?: (params: Record<string, unknown>) => Promise<JsonValue>
  stewardSay?: (params: Record<string, unknown>) => JsonValue
}): Record<string, DaemonIpcHandler> {
  return {
    'protocol.info': () => {
      const status = input.getStatus()
      return {
        daemonVersion: input.daemonVersion,
        protocolVersion: input.protocolVersion,
        launcher: status.launcher,
        capabilities: [...DAEMON_CONTROL_CAPABILITIES],
      }
    },
    'daemon.status': () => input.getStatus() as unknown as JsonValue,
    'daemon.shutdown': (params, context) => {
      const expectedPid = params && typeof params === 'object' && !Array.isArray(params)
        ? params.expectedPid : undefined
      if (!Number.isSafeInteger(expectedPid) || expectedPid !== process.pid) {
        throw new Error('daemon_instance_mismatch')
      }
      if (!input.requestShutdown || !context.afterResponse) throw new Error('daemon_shutdown_unavailable')
      context.afterResponse(input.requestShutdown)
      return { accepted: true, pid: process.pid }
    },
    'agent.list': () => ({
      agents: input.getAgents().map((agent) => ({
        type: agent.type,
        ...(agent.version ? { version: agent.version } : {}),
        ...(agent.runtimePlatform ? { runtimePlatform: agent.runtimePlatform } : {}),
        ...(agent.runtimeIsWsl !== undefined ? { runtimeIsWsl: agent.runtimeIsWsl } : {}),
      })),
      acpMetrics: getAcpLocalMetrics(),
    }),
    'agent.auth.completed': async (params) => {
      const agentType = params && typeof params === 'object' && !Array.isArray(params)
        && typeof params.agentType === 'string' ? params.agentType : ''
      if (!/^acp:[a-z0-9][a-z0-9._-]{0,63}$/.test(agentType)) throw new Error('invalid_acp_agent')
      return { resumed: await input.completeAgentAuthentication?.(agentType) ?? false }
    },
    'room.agent.bind-managed': async (params) => {
      if (!params || typeof params !== 'object' || Array.isArray(params)) {
        throw new Error('invalid_managed_room_binding')
      }
      if (!input.bindManagedRoom) throw new Error('managed_room_binding_unavailable')
      return input.bindManagedRoom(params as Record<string, unknown>)
    },
    'steward.say': (params) => {
      if (!params || typeof params !== 'object' || Array.isArray(params)) throw new Error('invalid_steward_say')
      if (!input.stewardSay) throw new Error('steward_unavailable')
      return input.stewardSay(params as Record<string, unknown>)
    },
    'log.read': (params) => readDaemonLogPage(input.getStatus().logFile, params),
    'upgrade.start': async (params) => {
      if (!input.startUpgrade) throw new Error('upgrade_unavailable')
      return input.startUpgrade(params)
    },
    'upgrade.prepare-external': async (params) => {
      if (!input.prepareExternalUpgrade) throw new Error('external_upgrade_unavailable')
      return input.prepareExternalUpgrade(params)
    },
    'upgrade.cancel-external': async () => {
      if (!input.cancelExternalUpgrade) throw new Error('external_upgrade_unavailable')
      return input.cancelExternalUpgrade()
    },
  }
}

export function readDaemonLogPage(logFile: string, params: JsonValue | undefined): JsonValue {
  const object = params && typeof params === 'object' && !Array.isArray(params)
    ? params as Record<string, JsonValue>
    : {}
  const requestedLimit = typeof object.limitBytes === 'number' && Number.isFinite(object.limitBytes)
    ? object.limitBytes
    : DEFAULT_LOG_PAGE_BYTES
  const limitBytes = Math.max(1, Math.min(Math.floor(requestedLimit), MAX_LOG_PAGE_BYTES))

  let size = 0
  try {
    size = fs.statSync(logFile).size
  } catch {
    return { text: '', start: 0, end: 0, nextBefore: null, eof: true }
  }

  const requestedBefore = typeof object.before === 'number' && Number.isFinite(object.before)
    ? Math.floor(object.before)
    : size
  const end = Math.max(0, Math.min(requestedBefore, size))
  const start = Math.max(0, end - limitBytes)
  if (end === start) return { text: '', start, end, nextBefore: start > 0 ? start : null, eof: start === 0 }

  const buffer = Buffer.allocUnsafe(end - start)
  const fd = fs.openSync(logFile, 'r')
  try {
    fs.readSync(fd, buffer, 0, buffer.length, start)
  } finally {
    fs.closeSync(fd)
  }
  return {
    text: buffer.toString('utf8'),
    start,
    end,
    nextBefore: start > 0 ? start : null,
    eof: start === 0,
  }
}
