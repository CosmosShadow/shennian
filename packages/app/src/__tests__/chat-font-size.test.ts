// @covers packages/app/src/features/chat/preferences/chatFontSize.ts
// @covers packages/app/src/features/profile/ChatFontSizeScreen.tsx
// @covers packages/app/src/hooks/useChatFontSize.ts
// @covers packages/app/src/features/desktop-chat/desktopChatProcessCss.ts
import { describe, expect, it } from 'vitest'
import { desktopChatProcessCss } from '../features/desktop-chat/desktopChatProcessCss'
import { desktopTypography } from '../features/desktop-shell/desktopDesignTokens'
import { createChatFontPreference, chatTypography, desktopChatTypography, chatFontCss, CHAT_FONT_SIZE_KEY, DESKTOP_CHAT_FONT_SIZE_KEY, usesDesktopScopedRoomTypography } from '../features/chat/preferences/chatFontSize'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('device-local chat text size', () => {
  it('uses compact chat typography only for fine-pointer scoped Room browsers', () => {
    expect(usesDesktopScopedRoomTypography('web', true)).toBe(true)
    expect(usesDesktopScopedRoomTypography('web', false)).toBe(false)
    expect(usesDesktopScopedRoomTypography('ios', true)).toBe(false)
    expect(usesDesktopScopedRoomTypography('android', true)).toBe(false)
  })
  it('matches desktop summary typography to the reading size without adding mobile overrides', () => {
    expect(desktopChatProcessCss(false)).toBe('')
    const css = desktopChatProcessCss(true)
    for (const size of ['small', 'medium', 'large'] as const) {
      const body = desktopChatTypography[size].body
      expect(desktopChatProcessCss(true, size)).toContain(`font-size:${body.fontSize}px; line-height:${body.lineHeight}px; font-weight:400`)
    }
    expect(css).toContain('.cwv.cwv-desktop .tool-disclosure > summary')
    expect(css).toContain(`font-size:${desktopTypography.metadata.fontSize}px; line-height:${desktopTypography.metadata.lineHeight}px`)
    expect(css).toContain(`font-size:${desktopTypography.code.fontSize}px; line-height:${desktopTypography.code.lineHeight}px`)
    expect(css).toContain('color:var(--text-secondary)')
    expect(css).toContain('prefers-reduced-motion: reduce')
  })
  it('keeps desktop reading density and preference independent of mobile', async () => {
    const values = new Map([[CHAT_FONT_SIZE_KEY, 'large']])
    const storage = { getItem: async (key: string) => values.get(key) ?? null, setItem: async (key: string, value: string) => { values.set(key, value) } }
    const desktop = createChatFontPreference(storage, DESKTOP_CHAT_FONT_SIZE_KEY)
    await desktop.load()
    expect(desktop.getSnapshot().size).toBe('medium')
    expect(desktopChatTypography.medium.body).toEqual({ fontSize: 14, lineHeight: 21 })
    expect(chatFontCss('medium', 1, '.cwv ', true)).toContain('font-size:14px;line-height:21px')
    expect(chatFontCss('medium', 1, '.cwv ')).toContain('font-size:17px;line-height:25px')
    await desktop.setSize('small')
    expect(values.get(CHAT_FONT_SIZE_KEY)).toBe('large')
    const reopened = createChatFontPreference(storage, DESKTOP_CHAT_FONT_SIZE_KEY)
    await reopened.load()
    expect(reopened.getSnapshot().size).toBe('small')
  })
  it('defaults to medium and rejects invalid stored preferences', async () => {
    const state = createChatFontPreference({ getItem: async () => 'huge', setItem: async () => {} })
    expect(state.getSnapshot().size).toBe('medium')
    await state.load()
    expect(state.getSnapshot().size).toBe('medium')
    expect(chatTypography.medium.body).toEqual({ fontSize: 17, lineHeight: 25 })
    expect(chatTypography.small.system.fontSize).toBe(14)
  })
  it('restores a saved size, broadcasts changes and persists across a new instance', async () => {
    let saved: string | null = 'large'
    const storage = { getItem: async () => saved, setItem: async (key: string, value: string) => { expect(key).toBe(CHAT_FONT_SIZE_KEY); saved = value } }
    const state = createChatFontPreference(storage)
    let calls = 0
    const unsubscribe = state.subscribe(() => { calls++ })
    await state.load()
    expect(state.getSnapshot().size).toBe('large')
    await state.setSize('small')
    expect(calls).toBe(2)
    unsubscribe()
    const reopened = createChatFontPreference(storage)
    await reopened.load()
    expect(reopened.getSnapshot().size).toBe('small')
  })
  it('does not overwrite a user choice with a late storage read', async () => {
    let finish!: (value: string) => void
    const state = createChatFontPreference({ getItem: () => new Promise((resolve) => { finish = resolve }), setItem: async () => {} })
    const loading = state.load()
    await state.setSize('large')
    finish('small')
    await loading
    expect(state.getSnapshot().size).toBe('large')
  })
  it('serializes rapid selections and allows retry after persistence failure', async () => {
    const saved: string[] = []
    let fail = true
    const state = createChatFontPreference({ getItem: async () => null, setItem: async (_, value) => {
      if (fail) throw Error('unavailable')
      saved.push(value)
    } })
    await state.setSize('large')
    expect(state.getSnapshot()).toEqual({ size: 'large', saveFailed: true })
    fail = false
    const small = state.setSize('small')
    const medium = state.setSize('medium')
    await Promise.all([small, medium])
    expect(saved).toEqual(['small', 'medium'])
    expect(state.getSnapshot()).toEqual({ size: 'medium', saveFailed: false })
  })
  it('scales native WebView content with system text size without targeting navigation', () => {
    expect(chatFontCss('large', 1.5)).toContain('font-size:28.5px;line-height:42px')
    expect(chatFontCss('medium', 1, '.cwv ')).toContain('.cwv .bubble-user')
    expect(chatFontCss('small')).not.toContain('.time-separator')
    expect(chatFontCss('medium', NaN)).toContain('font-size:17px')
  })
  it('keeps Agent heading hierarchy modest and relative at every reading size', () => {
    for (const size of ['small', 'medium', 'large'] as const) {
      for (const scale of [1, 2]) {
        for (const scope of ['', '.cwv ']) {
          const css = chatFontCss(size, scale, scope)
          expect(css).toContain(`font-size:${chatTypography[size].body.fontSize * scale}px;line-height:${chatTypography[size].body.lineHeight * scale}px;`)
          for (const [tag, ratio] of [['h1', 1.25], ['h2', 1.12], ['h3', 1.06]]) {
            const rule = `${scope}.bubble-agent .md ${tag}{font-size:${ratio}em;line-height:1.45;}`
            expect(css).toContain(rule)
            expect(css.lastIndexOf(rule)).toBeGreaterThan(css.indexOf('font-size:1.1em'))
          }
          expect(css).toContain(`${scope}.bubble-agent .md h4,${scope}.bubble-agent .md h5,${scope}.bubble-agent .md h6{font-size:1em;line-height:1.45;}`)
          expect(css).not.toContain('font-weight:')
          expect(css).not.toContain('.chat-header')
        }
      }
    }
  })
  it('offers a preview and uses one setting for native/web Agent messages and both composers', () => {
    const read = (path: string) => readFileSync(resolve(__dirname, '..', path), 'utf8')
    const screen = read('features/profile/ChatFontSizeScreen.tsx')
    expect(screen).toContain('chat-font-preview')
    expect(screen).toContain('accessibilityRole="radio"')
    for (const file of [
      'features/rooms/components/RoomMessageRow.tsx', 'features/rooms/ScopedRoomConversationScreen.tsx',
      'features/rooms/components/RoomComposer.tsx', 'features/chat/components/ChatComposer.tsx',
      'components/chat/ChatWebView.native.tsx', 'components/chat/ChatWebView.web.tsx',
    ]) expect(read(file)).toContain('useChatFontSize(')
  })
})
