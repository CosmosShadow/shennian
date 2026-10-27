// @covers open-source/packages/server/src/routes/downloads.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'

const {
  mockGetDownloadStats,
  mockGetDownloadUrl,
  mockGetOssStream,
  mockGetRelease,
  mockIsValidPlatform,
  mockNeedsStreamProxy,
  mockRecordDownload,
} = vi.hoisted(() => ({
  mockGetDownloadStats: vi.fn(),
  mockGetDownloadUrl: vi.fn(),
  mockGetOssStream: vi.fn(),
  mockGetRelease: vi.fn(),
  mockIsValidPlatform: vi.fn(),
  mockNeedsStreamProxy: vi.fn(),
  mockRecordDownload: vi.fn(),
}))

vi.mock('../services/download.js', () => ({
  getDownloadStats: mockGetDownloadStats,
  getDownloadUrl: mockGetDownloadUrl,
  getOssStream: mockGetOssStream,
  getRelease: mockGetRelease,
  isValidPlatform: mockIsValidPlatform,
  needsStreamProxy: mockNeedsStreamProxy,
  recordDownload: mockRecordDownload,
}))

import { downloadRoutes } from '../routes/downloads.js'
import { parseReleaseManifest, isValidPlatform as validPlatform } from '../services/download-manifest.js'

describe('download routes', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    vi.clearAllMocks()
    mockRecordDownload.mockResolvedValue(undefined)
    mockGetRelease.mockResolvedValue({
      version: '0.1.29',
      date: '2026-04-20',
      platforms: {
        android: { url: 'v0.1.29/app-release.apk', size: 123 },
        ios: { url: 'v0.1.29/app.ipa', size: 456 },
      },
    })
    mockGetDownloadStats.mockResolvedValue([])

    app = Fastify()
    await app.register(downloadRoutes, { prefix: '/download' })
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
  })

  it('returns release metadata including ios artifacts', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/download',
    })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.payload)).toEqual(
      expect.objectContaining({
        version: '0.1.29',
        platforms: expect.objectContaining({
          ios: expect.objectContaining({
            url: 'v0.1.29/app.ipa',
          }),
        }),
      }),
    )
  })

  it('redirects ios downloads to a signed url', async () => {
    mockIsValidPlatform.mockImplementation((platform: string) => platform === 'ios')
    mockNeedsStreamProxy.mockReturnValue(false)
    mockGetDownloadUrl.mockResolvedValue({
      url: 'https://oss.example.com/v0.1.29/app.ipa?signature=1',
      version: '0.1.29',
      size: 456,
    })

    const res = await app.inject({
      method: 'GET',
      url: '/download/ios',
    })

    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('https://oss.example.com/v0.1.29/app.ipa?signature=1')
    expect(mockRecordDownload).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: 'ios',
        version: '0.1.29',
      }),
    )
  })

  it.each(['macos', 'windows'])('redirects %s using its own version and never caches the signed URL', async platform => {
    mockIsValidPlatform.mockReturnValue(true)
    mockNeedsStreamProxy.mockReturnValue(false)
    mockGetDownloadUrl.mockResolvedValue({url:'https://oss.example.com/file?signature=private',version:'0.4.1',size:99})
    const res = await app.inject({method:'GET',url:'/download/'+platform})
    expect(res.statusCode).toBe(302)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(mockRecordDownload).toHaveBeenCalledWith(expect.objectContaining({platform,version:'0.4.1'}))
  })
  it('distinguishes an unpublished package from a temporary storage failure', async () => {
    mockIsValidPlatform.mockReturnValue(true)
    mockNeedsStreamProxy.mockReturnValue(false)
    mockGetDownloadUrl.mockRejectedValueOnce(new Error('No release for platform: windows'))
    expect((await app.inject({method:'GET',url:'/download/windows'})).statusCode).toBe(404)
    mockGetDownloadUrl.mockRejectedValueOnce(new Error('secret storage response'))
    const res = await app.inject({method:'GET',url:'/download/windows'})
    expect(res.statusCode).toBe(503)
    expect(res.payload).not.toContain('secret')
  })

  it('rejects unsupported platforms with the expanded platform list', async () => {
    mockIsValidPlatform.mockReturnValue(false)

    const res = await app.inject({
      method: 'GET',
      url: '/download/linux',
    })

    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.payload)).toEqual({
      error: 'Invalid platform: linux. Valid: android, ios, macos, windows',
    })
  })
})


describe('public download manifest compatibility', () => {
  it('keeps each platform version independent when a legacy platform is present', () => {
    const manifest = parseReleaseManifest({ version: '0.4.0', date: '2026-09-16', platforms: {
      android: { url: 'v0.4.0/app.apk', size: 20 },
      windows: { url: 'v0.4.1/windows/abcd/Shennian Setup.exe', size: 40, version: '0.4.1', status: 'preview', arch: 'x64', sha256: 'a'.repeat(64) },
    } })
    expect(manifest?.platforms.android?.version).toBe('0.4.0')
    expect(manifest?.platforms.windows?.version).toBe('0.4.1')
  })

  it.each(['https://untrusted.example/app.exe', 'v0.4.1/../app.exe', 'v0.4.1/app.exe?key=x', 'v0.4.1/app.apk'])('rejects an unsafe or mismatched artifact key: %s', (url) => {
    expect(parseReleaseManifest({ version: '0.4.1', date: '2026-09-16', platforms: { windows: { url, size: 40 } } })?.platforms.windows).toBeUndefined()
  })

  it('rejects malformed pointers and recognizes only supported downloads', () => {
    expect(parseReleaseManifest({ version: null })).toBeNull()
    expect(validPlatform('windows')).toBe(true)
    expect(validPlatform('macos')).toBe(true)
    expect(validPlatform('linux')).toBe(false)
  })
})
