// @covers open-source/packages/server/src/routes/cli-release-policy.ts

import { describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import { cliReleasePolicyRoutes, readCliReleasePolicy } from '../routes/cli-release-policy.js'

describe('CLI release policy', () => {
  it('fails closed by default', () => {
    expect(readCliReleasePolicy({})).toEqual({
      automaticPatchEnabled: false,
      rolloutPercentage: 0,
      pausedVersions: [],
      blockedVersions: [],
      blockedCurrentVersions: [],
      killSwitch: true,
      releaseLevel: 'normal',
      maxIdleWaitMs: 1_800_000,
      requiredCapabilities: [],
      externalUpdaterEnabled: true,
    })
  })

  it('supports rollout, pause, block and the global kill switch', () => {
    expect(readCliReleasePolicy({
      CLI_AUTO_UPGRADE_ENABLED: '1',
      CLI_AUTO_UPGRADE_ROLLOUT_PERCENTAGE: '25',
      CLI_AUTO_UPGRADE_PAUSED_VERSIONS: '1.2.3, 1.2.4',
      CLI_AUTO_UPGRADE_BLOCKED_VERSIONS: '1.2.5',
      CLI_BLOCKED_CURRENT_VERSIONS: '1.1.0',
      CLI_AUTO_UPGRADE_KILL_SWITCH: '0',
      CLI_UPGRADE_RELEASE_LEVEL: 'required',
      CLI_AUTO_UPGRADE_MAX_IDLE_WAIT_MS: '5000',
      CLI_MIN_SESSION_SYNC_PROTOCOL: '3',
      CLI_MIN_SESSION_DATA_EPOCH: '2',
      CLI_REQUIRED_SESSION_CAPABILITIES: 'body-v2,deletions-v1',
      CLI_EXTERNAL_UPDATER_ENABLED: '1',
      CLI_MIN_UPDATER_PROTOCOL: '1',
    })).toEqual({
      automaticPatchEnabled: true,
      rolloutPercentage: 25,
      pausedVersions: ['1.2.3', '1.2.4'],
      blockedVersions: ['1.2.5'],
      blockedCurrentVersions: ['1.1.0'],
      killSwitch: false,
      releaseLevel: 'required',
      maxIdleWaitMs: 5000,
      minimumSessionSyncProtocolVersion: 3,
      minimumDataEpoch: 2,
      requiredCapabilities: ['body-v2', 'deletions-v1'],
      externalUpdaterEnabled: true,
      minimumUpdaterProtocolVersion: 1,
    })
  })
})

// Exercise the actual route registration with the checked-in production rewrite.
describe('CLI release policy HTTP paths', () => {
  it('serves the public edge rewrite and the legacy direct path identically', async () => {
    const app = Fastify()
    try {
      await app.register(cliReleasePolicyRoutes)
      const publicPath = '/api/releases/cli-policy'
      const edge = await app.inject({ method: 'GET', url: publicPath.replace(/^\/api\/(.*)/, '/$1') })
      const legacy = await app.inject({ method: 'GET', url: publicPath })
      expect(edge.statusCode).toBe(200)
      expect(legacy.statusCode).toBe(200)
      expect(edge.headers['cache-control']).toBe('public, max-age=60')
      expect(edge.json()).toEqual(readCliReleasePolicy())
      expect(legacy.json()).toEqual(edge.json())
    } finally {
      await app.close()
    }
  })
})
