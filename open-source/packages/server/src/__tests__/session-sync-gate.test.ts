// @covers src/relay/session-sync-gate.ts

import { describe, expect, it } from 'vitest'
import {
  SESSION_SYNC_REQUIRED_CAPABILITIES,
  SESSION_SYNC_RELEASE_GATE,
} from '@shennian/wire'
import {
  checkAppSessionSyncHandshake,
  checkDaemonSessionSyncHandshake,
} from '../relay/session-sync-gate.js'

function url(extra = ''): URL {
  const caps = encodeURIComponent(SESSION_SYNC_REQUIRED_CAPABILITIES.join(','))
  return new URL(`wss://shennian.net/relay/client?syncProtocol=2&dataEpoch=2&syncCapabilities=${caps}${extra}`)
}

describe('personal session sync hard-cut gate', () => {
  it('accepts only the complete daemon protocol plus stable installation identity', () => {
    expect(checkDaemonSessionSyncHandshake(url('&daemonInstallationId=install-1'))).toMatchObject({ allowed: true })
    expect(checkDaemonSessionSyncHandshake(new URL('wss://shennian.net/relay/machine'))).toMatchObject({
      allowed: false, code: 'upgrade_required', reason: 'session_sync_protocol_mismatch',
    })
    expect(checkDaemonSessionSyncHandshake(url('&daemonInstallationId='))).toMatchObject({
      allowed: false, reason: 'daemon_installation_identity_required',
    })
  })

  it('rejects incomplete capabilities and native builds below the frozen minimum', () => {
    const incomplete = new URL('wss://shennian.net/relay/client?syncProtocol=2&dataEpoch=2&syncCapabilities=session_index_v1&appBuild=999')
    expect(checkAppSessionSyncHandshake(incomplete, 'ios')).toMatchObject({
      allowed: false, reason: expect.stringContaining('missing_capabilities'),
    })
    expect(checkAppSessionSyncHandshake(url(`&appBuild=${SESSION_SYNC_RELEASE_GATE.minAppBuild.ios - 1}`), 'ios')).toMatchObject({
      allowed: false, reason: expect.stringContaining('app_build_too_old'),
    })
    expect(checkAppSessionSyncHandshake(url(`&appBuild=${SESSION_SYNC_RELEASE_GATE.minAppBuild.ios}`), 'ios')).toMatchObject({ allowed: true })
    expect(checkAppSessionSyncHandshake(url(`&appBuild=${SESSION_SYNC_RELEASE_GATE.minAppBuild.android}`), 'android')).toMatchObject({ allowed: true })
    expect(checkAppSessionSyncHandshake(url('&appBuild=999'), 'web')).toMatchObject({ allowed: false })
  })

  it('accepts an explicit compatible Desktop shell while ordinary web stays rejected', () => {
    expect(checkAppSessionSyncHandshake(
      url(`&desktopVersion=${SESSION_SYNC_RELEASE_GATE.minDesktopVersion}`),
      'desktop',
    )).toMatchObject({
      allowed: true,
      handshake: { desktopVersion: SESSION_SYNC_RELEASE_GATE.minDesktopVersion },
    })
    expect(checkAppSessionSyncHandshake(url('&desktopVersion=0.3.99'), 'desktop')).toMatchObject({
      allowed: false,
      reason: expect.stringContaining('desktop_version_too_old'),
    })
    expect(checkAppSessionSyncHandshake(url('&desktopVersion=not-a-version'), 'desktop')).toMatchObject({
      allowed: false,
      reason: expect.stringContaining('desktop_version_too_old'),
    })
    expect(checkAppSessionSyncHandshake(
      url(`&platform=desktop&desktopVersion=${SESSION_SYNC_RELEASE_GATE.minDesktopVersion}`),
      'web',
    )).toMatchObject({
      allowed: false,
      reason: 'app_build_too_old:min=native-only',
    })
  })

  it('fails closed when protocol or data epoch is absent or stale', () => {
    expect(checkDaemonSessionSyncHandshake(new URL(
      `wss://shennian.net/relay/machine?syncProtocol=2&syncCapabilities=${SESSION_SYNC_REQUIRED_CAPABILITIES.join(',')}&daemonInstallationId=install-1`,
    ))).toMatchObject({ allowed: false, code: 'epoch_mismatch' })
    expect(checkDaemonSessionSyncHandshake(new URL(
      `wss://shennian.net/relay/machine?syncProtocol=1&dataEpoch=2&syncCapabilities=${SESSION_SYNC_REQUIRED_CAPABILITIES.join(',')}&daemonInstallationId=install-1`,
    ))).toMatchObject({ allowed: false, code: 'upgrade_required' })
  })

  it('accepts the incident device build with protocol 2 and epoch 2', () => {
    expect(checkAppSessionSyncHandshake(url('&appBuild=53'), 'ios')).toMatchObject({
      allowed: true,
      handshake: { protocolVersion: 2, dataEpoch: 2, appBuild: 53 },
    })
  })
})
