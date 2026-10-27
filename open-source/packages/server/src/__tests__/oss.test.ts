// @covers open-source/packages/server/src/lib/oss.ts

import { afterEach, describe, expect, it, vi } from 'vitest'

const { ossConstructorMock, signatureUrlMock, headMock } = vi.hoisted(() => ({
  signatureUrlMock: vi.fn((key: string) => `https://public.example/${key}`),
  headMock: vi.fn(),
  ossConstructorMock: vi.fn().mockImplementation(function MockOss(this: {
    options: unknown
    signatureUrl: typeof signatureUrlMock
    head: typeof headMock
  }, options) {
    this.options = options
    this.signatureUrl = signatureUrlMock
    this.head = headMock
  }),
}))

vi.mock('ali-oss', () => ({ default: ossConstructorMock }))

async function importOss() {
  vi.resetModules()
  return import('../lib/oss.js')
}

describe('OSS client endpoints', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    ossConstructorMock.mockClear()
    signatureUrlMock.mockClear()
    headMock.mockReset()
  })

  it('uses the internal endpoint for production server-side OSS operations', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('ALIYUN_ACCESS_KEY_ID', 'ak')
    vi.stubEnv('ALIYUN_ACCESS_KEY_SECRET', 'sk')
    vi.stubEnv('OSS_REGION', 'oss-cn-hangzhou')

    const { getOssClient } = await importOss()
    getOssClient()

    expect(ossConstructorMock).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: 'https://oss-cn-hangzhou-internal.aliyuncs.com',
    }))
  })

  it('keeps signed download URLs on the public endpoint', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('ALIYUN_ACCESS_KEY_ID', 'ak')
    vi.stubEnv('ALIYUN_ACCESS_KEY_SECRET', 'sk')
    vi.stubEnv('OSS_REGION', 'oss-cn-hangzhou')

    const { signDownloadUrl } = await importOss()
    signDownloadUrl('shennian/test.txt')

    expect(ossConstructorMock).toHaveBeenCalledWith(expect.objectContaining({ secure: true }))
    expect(ossConstructorMock).toHaveBeenCalledWith(expect.not.objectContaining({
      endpoint: 'https://oss-cn-hangzhou-internal.aliyuncs.com',
    }))
  })

  it('can disable the internal endpoint for non-Aliyun production environments', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('OSS_USE_INTERNAL_ENDPOINT', '0')
    vi.stubEnv('ALIYUN_ACCESS_KEY_ID', 'ak')
    vi.stubEnv('ALIYUN_ACCESS_KEY_SECRET', 'sk')

    const { getOssClient } = await importOss()
    getOssClient()

    expect(ossConstructorMock).toHaveBeenCalledWith(expect.not.objectContaining({
      endpoint: expect.any(String),
    }))
  })

  it('signs private PUT uploads with the declared content type and hash metadata', async () => {
    vi.stubEnv('ALIYUN_ACCESS_KEY_ID', 'ak')
    vi.stubEnv('ALIYUN_ACCESS_KEY_SECRET', 'sk')
    const { signUploadUrl } = await importOss()

    signUploadUrl('rooms/room_1/file', {
      seconds: 300,
      contentType: 'image/png',
      sha256: 'a'.repeat(64),
    })

    expect(signatureUrlMock).toHaveBeenCalledWith('rooms/room_1/file', expect.objectContaining({
      method: 'PUT', expires: 300, 'Content-Type': 'image/png', 'x-oss-meta-sha256': 'a'.repeat(64),
    }))
  })

  it('reads server-trusted object length and type through HEAD', async () => {
    vi.stubEnv('ALIYUN_ACCESS_KEY_ID', 'ak')
    vi.stubEnv('ALIYUN_ACCESS_KEY_SECRET', 'sk')
    headMock.mockResolvedValue({
      res: { headers: {
        'content-length': '42', 'content-type': 'audio/mpeg', 'x-oss-meta-sha256': 'b'.repeat(64),
      } },
    })
    const { headObjectMetadata } = await importOss()

    await expect(headObjectMetadata('rooms/room_1/file')).resolves.toEqual({
      byteSize: 42, contentType: 'audio/mpeg', sha256: 'b'.repeat(64),
    })
  })
})
