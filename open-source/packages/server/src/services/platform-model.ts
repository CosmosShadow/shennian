// @arch open-source/docs/server-runtime.md
// @test src/__tests__/platform-model.test.ts

/** Platform-owned text tasks share one pinned model; specialty media models are separate. */
export const PLATFORM_TEXT_MODEL = 'deepseek-v4.1-flash-1017'
export const PLATFORM_TEXT_MODEL_NAME = 'DeepSeek V4.1 Flash (1017)'
export const DASHSCOPE_COMPATIBLE_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'

export function platformTextBaseUrl(): string {
  const value = process.env.PLATFORM_TEXT_BASE_URL?.trim()
    || process.env.DASHSCOPE_BASE_URL?.trim()
    || DASHSCOPE_COMPATIBLE_BASE_URL
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('invalid_platform_model_configuration')
  }
  return url.href.replace(/\/$/, '')
}
