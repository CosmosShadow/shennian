// @covers open-source/packages/server/src/services/download.ts
import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ provider: vi.fn(), get: vi.fn(), oss: vi.fn(), set: vi.fn() }))
vi.mock('../lib/oss.js', () => ({ getStorageProvider: mocks.provider, getOssClient: mocks.oss, signDownloadUrl: vi.fn() }))
vi.mock('../lib/redis.js', () => ({ redis: { get: mocks.get, set: mocks.set } }))
vi.mock('../lib/prisma.js', () => ({ prisma: {} }))
import { getRelease } from '../services/download.js'
beforeEach(() => vi.clearAllMocks())
it('does not consult cached official pointers or OSS when storage is local', async () => {
  mocks.provider.mockReturnValue('local')
  expect(await getRelease()).toBeNull()
  expect(mocks.get).not.toHaveBeenCalled()
  expect(mocks.oss).not.toHaveBeenCalled()
})
it('retains the configured OSS release path', async () => {
  mocks.provider.mockReturnValue('oss')
  mocks.get.mockResolvedValue(null)
  const get = vi.fn().mockRejectedValue(new Error('not published'))
  mocks.oss.mockReturnValue({ get })
  expect(await getRelease()).toBeNull()
  expect(get).toHaveBeenCalledWith('shennian/releases/stable.json')
})
