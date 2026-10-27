// @arch docs/features/free-growth-phase.md
// @covers packages/app/app/(main)/billing.tsx
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('retired billing surface', () => {
  it('keeps old links on the profile redirect without loading payment code', () => {
    const route = readFileSync(resolve(__dirname, '../../app/(main)/billing.tsx'), 'utf8')
    expect(route).toContain('<Redirect href="/(main)/profile" />')
    expect(route).not.toMatch(/BillingScreen|billingApi|authApi|fetch\s*\(/)
  })

  it('does not retain an unreferenced purchase screen or renderer billing requests', () => {
    for (const file of ['BillingScreen.tsx', 'billingApi.ts']) {
      expect(existsSync(resolve(__dirname, '../features/profile', file))).toBe(false)
    }
  })
})
