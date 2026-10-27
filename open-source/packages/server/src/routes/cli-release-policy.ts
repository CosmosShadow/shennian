// @arch open-source/docs/server-runtime.md
// @test open-source/packages/server/src/__tests__/cli-release-policy.test.ts

import type { FastifyPluginAsync } from 'fastify'
import { getCliDistribution, type CliDistributionChannel } from '../services/cli-release.js'
import { registerAuthDecorators, requireUserOrMachineAuth } from '../middleware/auth.js'

export type CliReleasePolicyResponse = {
  automaticPatchEnabled: boolean
  rolloutPercentage: number
  pausedVersions: string[]
  blockedVersions: string[]
  blockedCurrentVersions: string[]
  killSwitch: boolean
  releaseLevel: 'normal' | 'required' | 'blocked'
  maxIdleWaitMs: number
  minimumSessionSyncProtocolVersion?: number
  minimumDataEpoch?: number
  requiredCapabilities: string[]
  externalUpdaterEnabled: boolean
  minimumUpdaterProtocolVersion?: number
}

function readList(value: string | undefined): string[] {
  return value?.split(',').map((item) => item.trim()).filter(Boolean) ?? []
}

export function readCliReleasePolicy(env: NodeJS.ProcessEnv = process.env): CliReleasePolicyResponse {
  const parsedRollout = Number.parseInt(env.CLI_AUTO_UPGRADE_ROLLOUT_PERCENTAGE ?? '0', 10)
  const parsedIdleWait = Number.parseInt(env.CLI_AUTO_UPGRADE_MAX_IDLE_WAIT_MS ?? '1800000', 10)
  const parsedProtocol = Number.parseInt(env.CLI_MIN_SESSION_SYNC_PROTOCOL ?? '', 10)
  const parsedEpoch = Number.parseInt(env.CLI_MIN_SESSION_DATA_EPOCH ?? '', 10)
  const parsedUpdaterProtocol = Number.parseInt(env.CLI_MIN_UPDATER_PROTOCOL ?? '', 10)
  const releaseLevel = env.CLI_UPGRADE_RELEASE_LEVEL === 'required' || env.CLI_UPGRADE_RELEASE_LEVEL === 'blocked'
    ? env.CLI_UPGRADE_RELEASE_LEVEL
    : 'normal'
  return {
    automaticPatchEnabled: env.CLI_AUTO_UPGRADE_ENABLED === '1',
    rolloutPercentage: Number.isFinite(parsedRollout) ? Math.max(0, Math.min(100, parsedRollout)) : 0,
    pausedVersions: readList(env.CLI_AUTO_UPGRADE_PAUSED_VERSIONS),
    blockedVersions: readList(env.CLI_AUTO_UPGRADE_BLOCKED_VERSIONS),
    blockedCurrentVersions: readList(env.CLI_BLOCKED_CURRENT_VERSIONS),
    // Fail closed unless the operator explicitly enables automatic patch delivery.
    killSwitch: env.CLI_AUTO_UPGRADE_KILL_SWITCH !== '0',
    releaseLevel,
    maxIdleWaitMs: Number.isFinite(parsedIdleWait)
      ? Math.max(0, Math.min(24 * 60 * 60_000, parsedIdleWait))
      : 30 * 60_000,
    ...(Number.isFinite(parsedProtocol) ? { minimumSessionSyncProtocolVersion: parsedProtocol } : {}),
    ...(Number.isFinite(parsedEpoch) ? { minimumDataEpoch: parsedEpoch } : {}),
    requiredCapabilities: readList(env.CLI_REQUIRED_SESSION_CAPABILITIES),
    externalUpdaterEnabled: env.CLI_EXTERNAL_UPDATER_ENABLED !== '0',
    ...(Number.isFinite(parsedUpdaterProtocol)
      ? { minimumUpdaterProtocolVersion: parsedUpdaterProtocol }
      : {}),
  }
}

export const cliReleasePolicyRoutes: FastifyPluginAsync = async (app) => {
  registerAuthDecorators(app)
  // The public edge strips /api; retain the old direct-server path for compatibility.
  for (const path of ['/releases/cli-policy', '/api/releases/cli-policy']) {
    app.get(path, async (_request, reply) => {
      reply.header('Cache-Control', 'public, max-age=60')
      return readCliReleasePolicy()
    })
  }

  for (const path of ['/releases/cli', '/api/releases/cli']) {
    app.get<{ Querystring: { channel?: string } }>(path, {
      preHandler: requireUserOrMachineAuth,
    }, async (request, reply) => {
      if (!request.machineId) return reply.code(403).send({ error: 'machine_auth_required' })
      const channel = request.query.channel ?? 'stable'
      if (channel !== 'stable' && channel !== 'preview') {
        return reply.code(400).send({ error: 'channel must be stable or preview' })
      }
      const release = await getCliDistribution(channel as CliDistributionChannel)
      if (!release) return reply.code(404).send({ error: 'CLI release not found' })
      reply.header('Cache-Control', 'private, no-store')
      return release
    })
  }
}
