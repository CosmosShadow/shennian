// @test src/__tests__/steward-navigation.test.ts
// @arch docs/features/builtin-personal-agent.md
/** Model selection stays in the Client; the phone only configures a provider. */
export const personalModelProviders = [
  { id: 'aliyun', label: 'personal_model_provider_aliyun', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { id: 'tencent', label: 'personal_model_provider_tencent', baseUrl: 'https://tokenhub.tencentmaas.com/v1' },
  { id: 'deepseek', label: 'personal_model_provider_deepseek', baseUrl: 'https://api.deepseek.com' },
  { id: 'custom', label: 'personal_model_provider_custom', baseUrl: '' },
] as const
export const normalizedModelUrl = (url: string) => url.trim().replace(/\/$/, '')
export const personalModelProvider = (url: string) => personalModelProviders.find(p => p.baseUrl && p.baseUrl === normalizedModelUrl(url))?.id ?? 'custom'
