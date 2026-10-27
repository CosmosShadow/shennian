// @covers open-source/packages/server/src/services/cli-release.ts
// @covers open-source/packages/server/src/routes/cli-release-policy.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'

const { get, signDownloadUrl } = vi.hoisted(() => ({
  get: vi.fn(),
  signDownloadUrl: vi.fn((key: string) => `https://oss.example/${key}?signed=1`),
}))

vi.mock('../lib/oss.js', () => ({
  getOssClient: () => ({ get }),
  signDownloadUrl,
}))
vi.mock('../middleware/auth.js', () => ({
  registerAuthDecorators: (app: ReturnType<typeof Fastify>) => {
    app.decorateRequest('userId', '')
    app.decorateRequest('deviceId', '')
    app.decorateRequest('machineId', '')
  },
  requireUserOrMachineAuth: async (request: { headers: { authorization?: string }; machineId: string; userId: string }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => {
    if (request.headers.authorization === 'Bearer user-token') {
      request.userId = 'user-1'
      return
    }
    if (request.headers.authorization !== 'Bearer machine-token') {
      return reply.code(401).send({ error: 'Invalid token' })
    }
    request.machineId = 'machine-1'
  },
}))

import { cliReleasePolicyRoutes } from '../routes/cli-release-policy.js'
import { clearCliDistributionCache, getCliDistribution } from '../services/cli-release.js'

const stored = {
  schemaVersion: 1,
  channel: 'stable',
  version: '1.2.3',
  artifact: {
    objectKey: 'shennian/client/artifacts/1.2.3/shennian-1.2.3.tgz',
    size: 1234,
    integrity: `sha512-${Buffer.alloc(64, 1).toString('base64')}`,
  },
}

describe('CLI release distribution', () => {
  beforeEach(() => {
    clearCliDistributionCache()
    get.mockReset()
    signDownloadUrl.mockClear()
  })

  it('validates the OSS channel pointer and returns a short-lived signed artifact URL', async () => {
    get.mockResolvedValue({ content: Buffer.from(JSON.stringify(stored)) })
    await expect(getCliDistribution('stable')).resolves.toEqual({
      schemaVersion: 1,
      channel: 'stable',
      version: '1.2.3',
      artifact: {
        url: 'https://oss.example/shennian/client/artifacts/1.2.3/shennian-1.2.3.tgz?signed=1',
        size: 1234,
        integrity: stored.artifact.integrity,
      },
    })
    expect(signDownloadUrl).toHaveBeenCalledWith(stored.artifact.objectKey, 60)
  })

  it('rejects channel pointers that escape the CLI artifact prefix', async () => {
    get.mockResolvedValue({ content: Buffer.from(JSON.stringify({
      ...stored,
      artifact: { ...stored.artifact, objectKey: 'shennian/other/private.tgz' },
    })) })
    await expect(getCliDistribution('stable')).rejects.toThrow('Invalid CLI distribution manifest')
  })

  it('rejects a pointer whose version and immutable artifact key do not match', async () => {
    get.mockResolvedValue({ content: Buffer.from(JSON.stringify({ ...stored, version: '1.2.4' })) })
    await expect(getCliDistribution('stable')).rejects.toThrow('Invalid CLI distribution manifest')
  })

  it('serves stable by default and rejects unknown channels', async () => {
    get.mockResolvedValue({ content: Buffer.from(JSON.stringify(stored)) })
    const app = Fastify()
    await app.register(cliReleasePolicyRoutes)
    const unauthorized = await app.inject({ method: 'GET', url: '/releases/cli' })
    expect(unauthorized.statusCode).toBe(401)
    const userOnly = await app.inject({
      method: 'GET', url: '/releases/cli', headers: { authorization: 'Bearer user-token' },
    })
    expect(userOnly.statusCode).toBe(403)
    const release = await app.inject({
      method: 'GET', url: '/releases/cli', headers: { authorization: 'Bearer machine-token' },
    })
    expect(release.statusCode).toBe(200)
    expect(release.headers['cache-control']).toBe('private, no-store')
    expect(release.json().version).toBe('1.2.3')
    const invalid = await app.inject({
      method: 'GET', url: '/releases/cli?channel=nightly', headers: { authorization: 'Bearer machine-token' },
    })
    expect(invalid.statusCode).toBe(400)
    await app.close()
  })
})
