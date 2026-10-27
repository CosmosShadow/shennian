/**
 * @covers src/components/CompactCopyButton.tsx
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('compact copy button', () => {
  it('keeps a small website-style visual with an accessible touch target', () => {
    const source = readFileSync(resolve(__dirname, '../components/CompactCopyButton.tsx'), 'utf-8')

    expect(source).toContain('width: 36')
    expect(source).toContain('height: 36')
    expect(source).toContain('hitSlop={4}')
    expect(source).toContain('backgroundColor: colors.brandLight')
    expect(source).toContain("copied ? 'checkmark' : 'copy-outline'")
    expect(source).toContain('accessibilityLabel={copied ? copiedLabel : label}')
  })
})
