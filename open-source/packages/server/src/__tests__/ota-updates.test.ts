// @covers open-source/packages/server/src/routes/ota-updates.ts
// @covers open-source/packages/server/src/services/ota-update.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'

const { get } = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('../lib/oss.js', () => ({ getOssClient: () => ({ get }) }))

import { otaUpdateRoutes } from '../routes/ota-updates.js'
import { getOtaUpdate } from '../services/ota-update.js'

const id = '123e4567-e89b-42d3-a456-426614174000'
const asset = {
  hash: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  key: 'bundle',
  contentType: 'application/javascript',
  fileExtension: '.js',
  url: `https://videoindustry.oss-cn-hangzhou.aliyuncs.com/shennian/ota/updates/${id}/assets/bundle.js`,
}

describe('self-hosted Expo Updates endpoint', () => {
  beforeEach(() => get.mockReset())

  it('selects a signed update by channel, runtime and platform', async () => {
    const manifestBody = JSON.stringify({
      id, createdAt: '2026-09-14T00:00:00.000Z', runtimeVersion: '0.5.0',
      launchAsset: asset, assets: [], metadata: { channel: 'preview' }, extra: {},
    })
    get
      .mockResolvedValueOnce({ content: Buffer.from(JSON.stringify({
        schemaVersion: 1, channel: 'preview', runtimeVersion: '0.5.0', platform: 'ios',
        updateId: id, manifestKey: `shennian/ota/updates/${id}/ios/manifest.json`,
      })) })
      .mockResolvedValueOnce({ content: Buffer.from(JSON.stringify({
        schemaVersion: 1,
        signature: `sig="${Buffer.alloc(256, 1).toString('base64')}", keyid="main"`,
        manifestBody,
      })) })
    const app = Fastify()
    await app.register(otaUpdateRoutes)
    const response = await app.inject({ method: 'GET', url: '/updates', headers: {
      'expo-protocol-version': '1', 'expo-platform': 'ios',
      'expo-runtime-version': '0.5.0', 'expo-channel-name': 'preview',
      'expo-expect-signature': 'sig, keyid="main", alg="rsa-v1_5-sha256"',
    } })
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('application/expo+json')
    expect(response.headers['expo-signature']).toContain('keyid="main"')
    expect(response.body).toBe(manifestBody)
    expect(response.json().id).toBe(id)
    expect(get).toHaveBeenNthCalledWith(1, 'shennian/ota/channels/preview/0.5.0/ios.json')
    await app.close()
  })

  it('treats a missing OSS pointer as no published update', async () => {
    await expect(getOtaUpdate(
      { channel: 'production', platform: 'android', runtimeVersion: '9.9.9' },
      { getObject: async () => { throw new Error('missing') } },
    )).resolves.toBeNull()
  })

  it('rejects asset URLs outside the configured OSS origin', async () => {
    const pointer = {
      schemaVersion: 1, channel: 'production', runtimeVersion: '0.5.0', platform: 'android',
      updateId: id, manifestKey: `shennian/ota/updates/${id}/android/manifest.json`,
    }
    const manifestBody = JSON.stringify({
      id, createdAt: '2026-09-14T00:00:00.000Z', runtimeVersion: '0.5.0',
      launchAsset: { ...asset, url: `https://example.com/shennian/ota/updates/${id}/assets/bundle.js` },
      assets: [], metadata: {}, extra: {},
    })
    const getObject = vi.fn()
      .mockResolvedValueOnce({ content: Buffer.from(JSON.stringify(pointer)) })
      .mockResolvedValueOnce({ content: Buffer.from(JSON.stringify({ schemaVersion: 1, manifestBody })) })
    await expect(getOtaUpdate(
      { channel: 'production', platform: 'android', runtimeVersion: '0.5.0' },
      { getObject },
    )).resolves.toBeNull()
  })

  it('rejects unsupported protocols and unknown channels before reading OSS', async () => {
    const app = Fastify()
    await app.register(otaUpdateRoutes)
    expect((await app.inject({ method: 'GET', url: '/updates' })).statusCode).toBe(406)
    const invalid = await app.inject({ method: 'GET', url: '/updates', headers: {
      'expo-protocol-version': '1', 'expo-platform': 'ios',
      'expo-runtime-version': '0.5.0', 'expo-channel-name': 'nightly',
    } })
    expect(invalid.statusCode).toBe(400)
    expect(get).not.toHaveBeenCalled()
    await app.close()
  })
})
