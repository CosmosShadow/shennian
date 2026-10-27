// @covers packages/app/src/features/chat/utils/capabilityDraft.ts

import { describe, expect, it } from 'vitest'
import { appendCapabilityInvocation } from '../features/chat/utils/capabilityDraft'

describe('Agent capability draft insertion', () => {
  it('inserts a native invocation into an empty draft', () => {
    expect(appendCapabilityInvocation('', '$review')).toBe('$review ')
  })

  it('preserves existing text and spacing', () => {
    expect(appendCapabilityInvocation('please inspect', '/browser:browse')).toBe(
      'please inspect /browser:browse ',
    )
    expect(appendCapabilityInvocation('please inspect\n', '/docs')).toBe('please inspect\n/docs ')
  })
})
