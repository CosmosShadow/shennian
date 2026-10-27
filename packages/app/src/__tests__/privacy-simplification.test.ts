/**
 * @covers packages/app/app/privacy.tsx
 * @covers packages/app/app/support.tsx
 * @covers packages/app/src/features/landing/LandingContent.tsx
 * @covers packages/app/src/features/privacy/aiDataConsent.ts
 * @covers packages/app/src/features/privacy/webAiDataConsent.ts
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { alert, openURL, showWebAiDataConsent } = vi.hoisted(() => ({
  alert: vi.fn(), openURL: vi.fn(), showWebAiDataConsent: vi.fn(),
}))

vi.mock('react-native', () => ({
  Alert: { alert },
  Linking: { openURL },
  Platform: { OS: 'web' },
}))
vi.mock('../config/server', () => ({ PUBLIC_SITE_URL: 'https://shennian.net' }))
vi.mock('../features/privacy/webAiDataConsent', () => ({ showWebAiDataConsent }))

import {
  grantAiDataConsent,
  hasAiDataConsent,
  requestAiDataConsent,
  revokeAiDataConsents,
} from '../features/privacy/aiDataConsent'
const { showWebAiDataConsent: renderWebConsent } = await vi.importActual<
  typeof import('../features/privacy/webAiDataConsent')
>('../features/privacy/webAiDataConsent')

function readSource(path: string): string {
  return readFileSync(resolve(__dirname, path), 'utf8')
}

const consentValues = new Map<string, string>()

beforeEach(() => {
  consentValues.clear()
  alert.mockReset()
  openURL.mockReset().mockResolvedValue(undefined)
  showWebAiDataConsent.mockReset()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => consentValues.get(key) ?? null,
      setItem: (key: string, value: string) => consentValues.set(key, value),
    },
  })
})

describe('public privacy surface', () => {
  it('keeps privacy and contact links on the restored public homepage', () => {
    const landing = readSource('../features/landing/FullLandingContent.tsx')

    expect(landing).toContain('href="/privacy"')
    expect(landing).toContain("t('landing_simple_contact')")
    expect(landing).not.toContain('href="/support"')
    expect(landing).not.toContain("t('support_title')")
  })

  it('renders the privacy policy as plain reading content without chrome', () => {
    const privacy = readSource('../../app/privacy.tsx')

    expect(privacy).toContain('<PrivacyZh />')
    expect(privacy).toContain('<PrivacyEn />')
    expect(privacy).toContain('maxWidth: 720')
    expect(privacy).not.toContain('navOuter')
    expect(privacy).not.toContain('navBrand')
    expect(privacy).not.toContain('toggleLang')
    expect(privacy).not.toContain('footerInner')
    expect(privacy).not.toContain('href="/support"')
    expect(privacy).toContain('六个自然月')
    expect(privacy).toContain('三十天')
    expect(privacy).toContain('未满十四周岁')
    expect(privacy).toContain('设置 → 账号 → 注销账号')
    expect(privacy).toContain('不在神念云端持久化')
    expect(privacy).not.toContain('support@shennian.ai')
    expect(privacy).not.toContain('Apple 登录和 Google 登录用于身份验证')
  })

  it('restores a focused public support page without stale contact channels', () => {
    const support = readSource('../../app/support.tsx')

    expect(support).toContain('href="/docs"')
    expect(support).toContain('href="/privacy"')
    expect(support).toContain('<ContactOptions />')
    const contact = readSource('../features/contact/ContactOptions.tsx')
    expect(readSource('../features/contact/saveContactQr.ts')).toContain('/landing/wechat-group-qr.jpg')
    expect(contact).toContain('getOfficialRoomUrl()')
    expect(support).toContain('lichenarthurdata@gmail.com')
    expect(contact).toContain("t('contact_wechat')")
    expect(support).toContain("Platform.OS !== 'web'")
    expect(support).not.toContain('<Redirect href="/landing" />')
    expect(support).not.toContain('github.com')
    expect(support).not.toContain('support@shennian.ai')
  })
})

describe('AI data consent', () => {
  it('names the fixed AI voice processor in both consent languages', () => {
    const zh = readSource('../../../../open-source/packages/shared/src/i18n/zh-core-part-5.ts')
    const en = readSource('../../../../open-source/packages/shared/src/i18n/en-core-part-5.ts')

    expect(zh).toContain('阿里云百炼（Alibaba Cloud Model Studio / Bailian）')
    expect(en).toContain('Alibaba Cloud Model Studio (Bailian)')
  })

  it('keeps consent separate by account and data path, then revokes the account record', async () => {
    await grantAiDataConsent('account-a', 'personal')
    expect(await hasAiDataConsent('account-a', 'personal')).toBe(true)
    expect(await hasAiDataConsent('account-a', 'room')).toBe(false)
    expect(await hasAiDataConsent('account-b', 'personal')).toBe(false)

    await grantAiDataConsent('account-a', 'room')
    await revokeAiDataConsents('account-a')
    expect(await hasAiDataConsent('account-a', 'personal')).toBe(false)
    expect(await hasAiDataConsent('account-a', 'room')).toBe(false)
  })

  it('requires separate consent for cloud content creation rather than reusing local personal consent', async () => {
    await grantAiDataConsent('account-a', 'personal')
    expect(await hasAiDataConsent('account-a', 'interactive')).toBe(false)
    await grantAiDataConsent('account-a', 'interactive')
    expect(await hasAiDataConsent('account-a', 'interactive')).toBe(true)
    expect(await hasAiDataConsent('account-b', 'interactive')).toBe(false)
    await revokeAiDataConsents('account-a')
    expect(await hasAiDataConsent('account-a', 'interactive')).toBe(false)
  })

  it('renews only the changed voice disclosure while preserving other recorded permissions', async () => {
    consentValues.set('shennian:ai-data-consent:v1', JSON.stringify({
      'account-a': { personal: 1, room: 1, voice: 1 },
    }))

    expect(await hasAiDataConsent('account-a', 'personal')).toBe(true)
    expect(await hasAiDataConsent('account-a', 'room')).toBe(true)
    expect(await hasAiDataConsent('account-a', 'voice')).toBe(false)

    await grantAiDataConsent('account-a', 'voice')
    expect(await hasAiDataConsent('account-a', 'voice')).toBe(true)
    expect(JSON.parse(consentValues.get('shennian:ai-data-consent:v1') ?? '{}')).toEqual({
      'account-a': { personal: 1, room: 1, voice: 2 },
    })
  })

  it('records only an explicit allow action and skips later prompts', async () => {
    showWebAiDataConsent.mockResolvedValueOnce(true)
    const options = {
      accountId: 'account-a',
      kind: 'personal' as const,
      title: 'Connect your AI',
      message: 'Disclosure',
      allowLabel: 'Allow',
      declineLabel: 'Not now',
      privacyLabel: 'Privacy',
    }
    await expect(requestAiDataConsent(options)).resolves.toBe(true)
    await expect(requestAiDataConsent(options)).resolves.toBe(true)
    expect(showWebAiDataConsent).toHaveBeenCalledOnce()
    expect(alert).not.toHaveBeenCalled()
  })

  it('does not grant consent when the user declines or opens the privacy policy', async () => {
    showWebAiDataConsent.mockResolvedValueOnce(false)
    const base = {
      accountId: 'account-a', kind: 'voice' as const, title: 'Voice', message: 'Disclosure',
      allowLabel: 'Allow', declineLabel: 'Not now', privacyLabel: 'Privacy',
    }
    await expect(requestAiDataConsent(base)).resolves.toBe(false)
    expect(await hasAiDataConsent('account-a', 'voice')).toBe(false)

    showWebAiDataConsent.mockResolvedValueOnce(false)
    await expect(requestAiDataConsent(base)).resolves.toBe(false)
    expect(await hasAiDataConsent('account-a', 'voice')).toBe(false)
    expect(showWebAiDataConsent).toHaveBeenCalledWith(expect.objectContaining({ privacyUrl: 'https://shennian.net/privacy' }))
  })
})

class ConsentElementStub {
  children: ConsentElementStub[] = []
  listeners = new Map<string, (event: { preventDefault(): void }) => void>()
  style: Record<string, string> = {}
  textContent = ''
  type = ''
  removed = false
  closed = false
  open = false
  focused = false
  append(...children: ConsentElementStub[]) { this.children.push(...children) }
  setAttribute() {}
  addEventListener(type: string, listener: (event: { preventDefault(): void }) => void) { this.listeners.set(type, listener) }
  dispatch(type: string) { this.listeners.get(type)?.({ preventDefault() {} }) }
  showModal() { this.open = true }
  close() { this.closed = true; this.open = false }
  remove() { this.removed = true }
  focus() { this.focused = true }
}

const webConsentCopy = {
  title: 'AI in this room', message: 'Your message may be read by AI.',
  allowLabel: 'Allow', declineLabel: 'Not now', privacyLabel: 'Privacy',
  privacyUrl: 'https://shennian.net/privacy',
}

describe('web AI data consent dialog', () => {
  let body: ConsentElementStub
  let previousFocus: ConsentElementStub
  beforeEach(() => {
    body = new ConsentElementStub()
    previousFocus = new ConsentElementStub()
    vi.stubGlobal('document', {
      activeElement: previousFocus,
      body,
      createElement: () => new ConsentElementStub(),
    })
  })

  it('waits for an explicit allow action and restores focus', async () => {
    const result = renderWebConsent(webConsentCopy)
    const dialog = body.children[0]
    const actions = dialog.children[2]
    expect(actions.children[1].focused).toBe(true)
    actions.children[2].dispatch('click')
    await expect(result).resolves.toBe(true)
    expect(dialog.closed && dialog.removed && previousFocus.focused).toBe(true)
  })

  it('declines on Escape and opens privacy without granting consent', async () => {
    const escaped = renderWebConsent(webConsentCopy)
    body.children[0].dispatch('cancel')
    await expect(escaped).resolves.toBe(false)

    const privacy = renderWebConsent(webConsentCopy)
    body.children[1].children[2].children[0].dispatch('click')
    await expect(privacy).resolves.toBe(false)
    expect(openURL).toHaveBeenCalledWith(webConsentCopy.privacyUrl)
  })
})
