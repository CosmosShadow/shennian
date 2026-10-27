// @arch docs/architecture/app/modular-features.md#登录-feature
// @covers packages/app/src/features/auth/components/PhoneLoginPanel.tsx

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('public phone login', () => {
  it('does not render invitation fields, help, or rewards', () => {
    const source = readFileSync(
      resolve(__dirname, '../features/auth/components/PhoneLoginPanel.tsx'),
      'utf-8',
    )

    expect(source).not.toContain('inviteCode')
    expect(source).not.toContain('invite_code_')
    expect(source).not.toContain('inviteHelp')
    expect(source).not.toContain('INVITE_HELP_SLOT')
  })

  it('uses a readable native text size for phone and verification-code inputs', () => {
    const source = readFileSync(
      resolve(__dirname, '../features/auth/components/PhoneLoginPanel.tsx'),
      'utf-8',
    )

    expect(source).toContain("Platform.OS !== 'web' && styles.nativeInput")
    expect(source).toContain('nativeInput: {\n    fontSize: 17')
    expect(source).toContain('nativePrefix: {\n    fontSize: 16')
  })
})
