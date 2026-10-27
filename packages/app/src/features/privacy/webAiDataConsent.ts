// @arch docs/features/ai-data-sharing-consent.md#二三类许可
// @test src/__tests__/privacy-simplification.test.ts

import { Linking } from 'react-native'

export function showWebAiDataConsent(copy: {
  title: string
  message: string
  allowLabel: string
  declineLabel: string
  privacyLabel: string
  privacyUrl: string
}): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve(false)
      return
    }

    const previousFocus = document.activeElement as HTMLElement | null
    const dialog = document.createElement('dialog')
    dialog.setAttribute('aria-label', copy.title)
    dialog.style.cssText = 'max-width:min(440px,calc(100vw - 32px));border:1px solid #888;border-radius:12px;padding:24px;color:CanvasText;background:Canvas;box-shadow:0 16px 48px #0004;'
    const title = document.createElement('h2')
    title.textContent = copy.title
    title.style.cssText = 'font-size:18px;line-height:1.4;margin:0 0 12px;'
    const message = document.createElement('p')
    message.textContent = copy.message
    message.style.cssText = 'font-size:14px;line-height:1.6;margin:0 0 20px;white-space:pre-wrap;'
    const actions = document.createElement('div')
    actions.style.cssText = 'display:flex;justify-content:flex-end;align-items:center;gap:10px;flex-wrap:wrap;'
    const button = (label: string) => {
      const element = document.createElement('button')
      element.type = 'button'
      element.textContent = label
      element.style.cssText = 'min-height:36px;padding:6px 12px;border:1px solid #888;border-radius:8px;color:CanvasText;background:Canvas;cursor:pointer;'
      return element
    }
    const privacy = button(copy.privacyLabel)
    const decline = button(copy.declineLabel)
    const allow = button(copy.allowLabel)
    allow.style.background = '#6650c8'
    allow.style.color = '#fff'
    allow.style.borderColor = '#6650c8'
    actions.append(privacy, decline, allow)
    dialog.append(title, message, actions)

    let settled = false
    const finish = (approved: boolean) => {
      if (settled) return
      settled = true
      if (dialog.open) dialog.close()
      dialog.remove()
      previousFocus?.focus()
      resolve(approved)
    }
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault()
      finish(false)
    })
    privacy.addEventListener('click', () => {
      void Linking.openURL(copy.privacyUrl).catch(() => {})
      finish(false)
    })
    decline.addEventListener('click', () => finish(false))
    allow.addEventListener('click', () => finish(true))

    document.body.append(dialog)
    try {
      dialog.showModal()
      decline.focus()
    } catch {
      finish(false)
    }
  })
}
