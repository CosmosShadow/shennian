// @arch open-source/docs/shared-runtime.md
// @test src/__tests__/i18n-reasoning-effort.test.ts
import { enDocsPart1 } from './en-docs-part-1'
import { enDocsPart2 } from './en-docs-part-2'

export const enDocs = {
  ...enDocsPart1,
  ...enDocsPart2,
} as const
