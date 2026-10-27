// @covers open-source/packages/server/src/services/platform-model.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PLATFORM_TEXT_MODEL, platformTextBaseUrl } from '../services/platform-model.js'
import { contentProviderConfig } from '../services/interactive-web/providers.js'

afterEach(() => vi.unstubAllEnvs())
describe('platform text model configuration', () => {
  it('pins the verified snapshot and shares the compatible endpoint', () => {
    vi.stubEnv('PLATFORM_TEXT_BASE_URL', '')
    vi.stubEnv('DASHSCOPE_BASE_URL', '')
    expect(PLATFORM_TEXT_MODEL).toBe('deepseek-v4.1-flash-1017')
    expect(platformTextBaseUrl()).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1')
    expect(contentProviderConfig().model).toBe(PLATFORM_TEXT_MODEL)
  })
  it('uses the one platform endpoint without changing image providers', () => {
    vi.stubEnv('PLATFORM_TEXT_BASE_URL', 'https://model.test/v1/')
    vi.stubEnv('INTERACTIVE_MODEL', 'old-per-feature-model')
    vi.stubEnv('INTERACTIVE_MODEL_API_KEY', 'old-per-feature-key')
    vi.stubEnv('DASHSCOPE_API_KEY', 'shared-test-key')
    vi.stubEnv('INTERACTIVE_IMAGE_MODEL', 'specialist-image-model')
    expect(contentProviderConfig()).toMatchObject({
      base: 'https://model.test/v1', key: 'shared-test-key', model: PLATFORM_TEXT_MODEL, imageModel: 'specialist-image-model',
    })
  })
  it('retains the existing DashScope endpoint override as a central fallback', () => {
    vi.stubEnv('PLATFORM_TEXT_BASE_URL', '')
    vi.stubEnv('DASHSCOPE_BASE_URL', 'https://workspace.test/compatible-mode/v1/')
    expect(platformTextBaseUrl()).toBe('https://workspace.test/compatible-mode/v1')
  })
  it.each(['http://model.test/v1', 'https://u:p@model.test/v1', 'https://model.test/v1?token=x', 'https://model.test/v1#x'])(
    'rejects unsafe platform endpoints: %s', (url) => {
      vi.stubEnv('PLATFORM_TEXT_BASE_URL', url)
      expect(platformTextBaseUrl).toThrow('invalid_platform_model_configuration')
    },
  )
})
