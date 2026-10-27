// @arch open-source/docs/shared-runtime.md
// @test src/__tests__/i18n-reasoning-effort.test.ts
import { zhDocsPart1 } from './zh-docs-part-1'
import { zhDocsPart2 } from './zh-docs-part-2'

export const zhDocs = {
  ...zhDocsPart1,
  ...zhDocsPart2,
} as const
