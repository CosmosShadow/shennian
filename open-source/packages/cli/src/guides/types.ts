// @arch open-source/docs/cli-runtime.md
export type FeatureGuide = {
  id: string
  title: string
  summary: string
  keywords: readonly string[]
  execution: 'client-command' | 'phone-guided' | 'mixed'
  body: string
}
