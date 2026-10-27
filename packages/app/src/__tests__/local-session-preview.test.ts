// @covers src/hooks/useSessionPreviews.native.ts
// @covers open-source/packages/shared/src/hooks/useSessionPreviews.ts

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))

describe('native session list preview source', () => {
  it('uses the local session-index projection without transcript subscriptions', () => {
    const source = readFileSync(resolve(here, '../hooks/useSessionPreviews.native.ts'), 'utf8')

    expect(source).toContain('createUseSessionPreviews()')
    expect(source).not.toContain('personalSessionBodyStore')
    expect(source).not.toContain('getLatestPreview')
    expect(source).not.toContain('.subscribe(')
  })

  it('keeps the compatibility hook side-effect free', () => {
    const source = readFileSync(
      resolve(here, '../../../../open-source/packages/shared/src/hooks/useSessionPreviews.ts'),
      'utf8',
    )

    expect(source).not.toContain('useEffect')
    expect(source).not.toContain('useSessionsStore')
    expect(source).not.toContain('setPreview(')
  })
})
