// @covers open-source/packages/server/src/services/interactive-web/assets.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { allowedImageDownload, assetUrl, isSupportedRaster, validAssetToken } from '../services/interactive-web/assets.js'
afterEach(() => vi.unstubAllEnvs())
describe('content asset capabilities and download boundaries', () => {
  it('uses scoped random capability URLs and compares tokens without prefix acceptance', () => {
    expect(assetUrl({ id: 'asset', readToken: 'private' })).toBe('https://shennian.net/api/interactive-content/assets/asset?token=private')
    expect(validAssetToken('abc', 'abc')).toBe(true)
    expect(validAssetToken('ab', 'abc')).toBe(false)
    expect(validAssetToken('abd', 'abc')).toBe(false)
  })
  it('does not pass SVG, HTML or renamed executable bytes to an image decoder', () => {
    expect(isSupportedRaster(Buffer.from('<svg><image href="file:///private"/></svg>'))).toBe(false)
    expect(isSupportedRaster(Buffer.from('<html>'))).toBe(false)
    expect(isSupportedRaster(Buffer.from([255,216,255,0]))).toBe(true)
  })
  it('denies localhost, credential URLs, non-HTTPS and redirect destinations by default', () => {
    for (const value of ['http://x.aliyuncs.com/image', 'https://127.0.0.1/image', 'https://localhost/image',
      'https://x.aliyuncs.com.evil.test/x', 'https://u:p@x.aliyuncs.com/image', 'https://x.aliyuncs.com:8000/image']) {
      expect(() => allowedImageDownload(value)).toThrow('image_download_host_denied')
    }
    expect(allowedImageDownload('https://output.oss-cn-beijing.aliyuncs.com/image')).toContain('aliyuncs.com')
    vi.stubEnv('INTERACTIVE_IMAGE_DOWNLOAD_HOSTS', 'cdn.provider.test')
    expect(allowedImageDownload('https://cdn.provider.test/image')).toContain('cdn.provider.test')
  })
})
