// @arch docs/architecture/app/modular-features.md#登录-provider-注册表
// @covers packages/app/src/features/auth/providers.ts
// @covers packages/app/src/features/auth/utils/verifyCodeError.ts

import { readI18nSource } from './i18n-source-test-helper'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ApiError } from '@shennian/shared'
import { describe, expect, it, vi } from 'vitest'
import { requestNicknameSetup, useNicknamePrompt } from '../features/auth/nicknameSetup'
import {
  buildIdentityProviderSpecs,
  getVisibleIdentityProviderSpecs,
} from '../features/auth/providers'
import { getVerifyCodeErrorTranslationKey } from '../features/auth/utils/verifyCodeError'
import { emptyPublicAuthConfig } from '../features/auth/types'

function readLoginScreenSource(): string {
  return readFileSync(resolve(__dirname, '../features/auth/screens/LoginScreen.tsx'), 'utf-8')
}

describe('post-login optional nickname reminder', () => {
  it('allows skipping without saving, and offers the same provisional name next login', async () => {
    const save = vi.fn(async () => {})
    const first = requestNicknameSetup({ name: '用户123', save })
    const prompt = useNicknamePrompt.getState().prompt!
    expect(prompt.name).toBe('用户123')
    prompt.finish()
    await first
    expect(save).not.toHaveBeenCalled()
    expect(useNicknamePrompt.getState().prompt).toBeNull()
    const next = requestNicknameSetup({ name: '用户123', save })
    expect(useNicknamePrompt.getState().prompt?.name).toBe('用户123')
    useNicknamePrompt.getState().prompt!.finish()
    await next
  })

  it('keeps failed saves dismissible and a late completion cannot close a newer login prompt', async () => {
    const first = requestNicknameSetup({
      name: '用户123',
      save: async () => {
        throw new Error('offline')
      },
    })
    const stale = useNicknamePrompt.getState().prompt!
    await expect(stale.save('小林')).rejects.toThrow('offline')
    expect(useNicknamePrompt.getState().prompt).toBe(stale)
    stale.finish()
    await first
    const next = requestNicknameSetup({ name: '用户456', save: async () => {} })
    stale.finish()
    expect(useNicknamePrompt.getState().prompt?.name).toBe('用户456')
    useNicknamePrompt.getState().prompt!.finish()
    await next
  })
})

function readPhoneLoginPanelSource(): string {
  return readFileSync(
    resolve(__dirname, '../features/auth/components/PhoneLoginPanel.tsx'),
    'utf-8',
  )
}

function readQrLoginPanelSource(): string {
  return readFileSync(resolve(__dirname, '../features/auth/components/QrLoginPanel.tsx'), 'utf-8')
}

function readAuthPublicConfigSource(): string {
  return readFileSync(resolve(__dirname, '../features/auth/hooks/useAuthPublicConfig.ts'), 'utf-8')
}

function readZhI18nSource(): string {
  return readI18nSource('../../../../open-source/packages/shared/src/i18n/zh.ts')
}

describe('auth provider registry', () => {
  it('exposes google as a visible provider when the platform client is configured', () => {
    const specs = buildIdentityProviderSpecs(
      {
        ...emptyPublicAuthConfig(),
        googleWebClientId: 'web-client-id',
      },
      'web',
    )

    expect(getVisibleIdentityProviderSpecs(specs)).toEqual([
      {
        id: 'google',
        status: 'ready',
        supportedPlatforms: ['web', 'ios', 'android'],
      },
    ])
  })

  it('exposes apple as a visible provider on ios when bundle config is available', () => {
    const specs = buildIdentityProviderSpecs(
      {
        ...emptyPublicAuthConfig(),
        appleEnabled: true,
        appleBundleId: 'net.shengnian.app',
      },
      'ios',
    )

    expect(specs.find((spec) => spec.id === 'apple')).toEqual({
      id: 'apple',
      status: 'ready',
      supportedPlatforms: ['ios', 'web'],
    })
    expect(getVisibleIdentityProviderSpecs(specs).map((spec) => spec.id)).toContain('apple')
  })

  it('renders login immediately with local default public config', () => {
    const hookSource = readAuthPublicConfigSource()
    const screenSource = readLoginScreenSource()

    expect(hookSource).toContain('useState<PublicAuthConfig>(() => emptyPublicAuthConfig())')
    expect(screenSource).not.toContain('if (!config)')
  })

  it('keeps invite errors only for invalid optional invite codes', () => {
    const errorKeyFor = (error: string) =>
      getVerifyCodeErrorTranslationKey(new ApiError(403, JSON.stringify({ error })))

    expect(errorKeyFor('invite_required')).toBe('error_invite_required')
    expect(errorKeyFor('invite_invalid')).toBe('error_invite_invalid')
    expect(errorKeyFor('invite_expired')).toBe('error_invite_expired')
    expect(errorKeyFor('invite_exhausted')).toBe('error_invite_exhausted')
    expect(errorKeyFor('invalid_code')).toBe('error_verify_code')
    expect(readZhI18nSource()).toContain("error_invite_required: '邀请码可选，可不填写直接注册'")
  })

  it('maps Desktop broker codes to safe actionable login copy', () => {
    const brokerError = (code: string) =>
      Object.assign(new Error('raw broker message must not be rendered'), { code })

    expect(getVerifyCodeErrorTranslationKey(brokerError('CREDENTIAL_COMMIT_FAILED'))).toBe(
      'desktop_login_credential_commit_failed',
    )
    expect(getVerifyCodeErrorTranslationKey(brokerError('RATE_LIMITED'))).toBe(
      'error_send_code_rate_limit',
    )
    expect(getVerifyCodeErrorTranslationKey(brokerError('LOGIN_REJECTED'))).toBe(
      'error_verify_code',
    )
    expect(readZhI18nSource()).toContain(
      "desktop_login_credential_commit_failed: '无法安全保存登录，请解锁系统凭据存储后重试'",
    )
  })

  it('keeps the public login surface phone-only', () => {
    const screenSource = readLoginScreenSource()
    const panelSource = readPhoneLoginPanelSource()

    expect(screenSource).not.toContain('inviteCode?: string')
    expect(screenSource).not.toContain('initialInviteCode')
    expect(panelSource).not.toContain('invite-code-input')
    expect(panelSource).not.toContain('AppleSignInButton')
    expect(panelSource).not.toContain('GoogleSignInButton')
    expect(panelSource).toContain('testID="phone-input"')
  })

  it('renders the branded, labeled native phone login without a competing action', () => {
    const screenSource = readLoginScreenSource()
    const panelSource = readPhoneLoginPanelSource()

    expect(screenSource).toContain('testID="native-login-title"')
    expect(screenSource).toContain("t('login_form_title_default')")
    expect(screenSource).not.toContain("t('login_form_subtitle_default')")
    expect(screenSource).toContain('style={[styles.title, { color: colors.text }]}')
    expect(screenSource).toContain('styles.nativeBrandRow')
    expect(screenSource).toContain('source={logoSource}')
    expect(screenSource).toContain("textAlign: 'left'")
    expect(screenSource).toContain('styles.nativeLegal')
    expect(screenSource).toContain('keyboardDismissMode="on-drag"')
    expect(screenSource).toContain("t('privacy_title')")
    expect(screenSource).toContain('isDesktopShell ? desktopStyles.formContent')
    expect(screenSource).toContain(
      "backgroundColor: isWeb && !isDesktopShell ? colors.surface : 'transparent'",
    )
    expect(screenSource).toContain('nativeForm: {')
    expect(screenSource).toContain('padding: 0')
    expect(screenSource).not.toContain('<View style={styles.nativeLangRow}>')
    expect(panelSource).toContain("t('phone_field_label')")
    expect(panelSource).toContain("t('code_field_label')")
    expect(panelSource).toContain("t('get_code')")
    expect(panelSource).toContain("focusedField === 'phone' ? colors.brand : colors.border")
    expect(panelSource).toContain('sendCodeDisabled ? colors.textTertiary : colors.brand')
    expect(panelSource).toContain('loginDisabled\n                ? colors.brandLight')
    expect(panelSource).toMatch(/nativeLoginBtn: \{[\s\S]*?marginTop: 24,/)
  })

  it('gives Desktop a compact iOS-derived login surface with explicit, accessible methods', () => {
    const screenSource = readLoginScreenSource()
    const frameSource = readFileSync(
      resolve(__dirname, '../features/desktop-onboarding/DesktopLoginFrame.tsx'),
      'utf8',
    )
    const panelSource = readPhoneLoginPanelSource()
    const qrPanelSource = readQrLoginPanelSource()

    expect(screenSource).toContain("presentation={isDesktopShell ? 'desktop' : 'default'}")
    expect(screenSource).toContain('accessibilityRole="tablist"')
    expect(screenSource).toContain('accessibilityRole="tab"')
    expect(screenSource).toContain('accessibilityState={{ selected: tab === key }}')
    expect(screenSource).not.toContain('formSubtitleKey')
    expect(frameSource).toContain('maxWidth: 420')
    expect(frameSource).toContain('height < 640 && styles.contentCompact')
    expect(screenSource).toMatch(/tabText: \{[\s\S]*?fontSize: 15,[\s\S]*?lineHeight: 22,/)
    expect(panelSource).toContain("presentation?: 'default' | 'desktop'")
    expect(panelSource).toContain('onSubmitEditing={() => codeInputRef.current?.focus()}')
    expect(panelSource).toContain('if (!loginDisabled) void onLogin()')
    expect(qrPanelSource).toContain('accessibilityRole="alert"')
    expect(qrPanelSource).toContain('testID="qr-retry-button"')
    expect(qrPanelSource).toContain('{error}')
    expect(qrPanelSource).toContain("t('qr_generating')")
  })

  it('uses the public domain for home navigation and a bounded responsive web shell', () => {
    const screenSource = readLoginScreenSource()
    const panelSource = readPhoneLoginPanelSource()

    expect(screenSource).toContain('window.location.assign(getPublicSiteUrl())')
    expect(screenSource).toContain('Linking.openURL(getPublicSiteUrl())')
    expect(screenSource).not.toContain("router.replace('/landing')")
    expect(screenSource).toContain('webStyles.authShell')
    expect(screenSource).toContain('!isWideWeb && webStyles.authShellMobile')
    expect(screenSource).toContain('const isWideWeb = hasMounted && width >= 768')
    expect(panelSource).toContain('backgroundColor: colors.surfaceHover')
    expect(screenSource).toContain('maxWidth: 980')
    expect(screenSource).not.toContain("backgroundColor: '#3d35c7'")
  })
})
