// @arch docs/features/chat-font-size.md
// @test src/__tests__/chat-font-size.test.ts

export type ChatFontSize = 'small' | 'medium' | 'large'
export const CHAT_FONT_SIZE_KEY = 'shennian:chat-font-size'
export const DESKTOP_CHAT_FONT_SIZE_KEY = 'shennian:desktop-chat-font-size'
export const chatFontSizes: ChatFontSize[] = ['small', 'medium', 'large']
export const chatTypography = {
  small: { body: { fontSize: 15, lineHeight: 22 }, author: { fontSize: 13, lineHeight: 19 }, system: { fontSize: 14, lineHeight: 20 } },
  medium: { body: { fontSize: 17, lineHeight: 25 }, author: { fontSize: 13, lineHeight: 19 }, system: { fontSize: 14, lineHeight: 20 } },
  large: { body: { fontSize: 19, lineHeight: 28 }, author: { fontSize: 15, lineHeight: 22 }, system: { fontSize: 16, lineHeight: 23 } },
} as const

/** Desktop density is independent of the touch-first mobile reading scale. */
export const desktopChatTypography = {
  small: { body: { fontSize: 13, lineHeight: 20 }, author: { fontSize: 12, lineHeight: 17 }, system: { fontSize: 12, lineHeight: 18 } },
  medium: { body: { fontSize: 14, lineHeight: 21 }, author: { fontSize: 12, lineHeight: 17 }, system: { fontSize: 12, lineHeight: 18 } },
  large: { body: { fontSize: 16, lineHeight: 24 }, author: { fontSize: 13, lineHeight: 19 }, system: { fontSize: 13, lineHeight: 19 } },
} as const

/** A scoped Room opened with a mouse/trackpad uses the compact desktop reading scale. */
export function usesDesktopScopedRoomTypography(platform: string, finePointer: boolean): boolean {
  return platform === 'web' && finePointer
}

export function normalizeChatFontSize(value: unknown): ChatFontSize {
  return value === 'small' || value === 'large' ? value : 'medium'
}

type Storage = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<unknown> }
export function createChatFontPreference(storage: Storage, storageKey = CHAT_FONT_SIZE_KEY) {
  let snapshot = { size: 'medium' as ChatFontSize, saveFailed: false }
  let revision = 0
  let loading: Promise<void> | undefined
  let writes = Promise.resolve()
  const listeners = new Set<() => void>()
  const publish = (size: ChatFontSize, saveFailed = false) => {
    snapshot = { size, saveFailed }
    listeners.forEach((listener) => listener())
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    load() {
      if (!loading) {
        const before = revision
        loading = storage.getItem(storageKey).then((value) => {
          if (before === revision) publish(normalizeChatFontSize(value))
        }).catch(() => { /* Default remains usable when storage is unavailable. */ })
      }
      return loading
    },
    setSize(value: ChatFontSize) {
      const size = normalizeChatFontSize(value)
      const current = ++revision
      publish(size)
      writes = writes.then(() => storage.setItem(storageKey, size)).then(() => {
        if (current === revision && snapshot.saveFailed) publish(size)
      }).catch(() => { if (current === revision) publish(size, true) })
      return writes
    },
  }
}

/** CSS only targets message content, not navigation, tool controls or timestamps. */
export function chatFontCss(size: ChatFontSize, scale = 1, scope = '', desktop = false) {
  const body = (desktop ? desktopChatTypography : chatTypography)[size].body
  const factor = Number.isFinite(scale) && scale > 0 ? scale : 1
  const selectors = ['.bubble-user', '.bubble-user .md', '.bubble-agent .md', '.md']
    .map((selector) => scope + selector).join(',')
  const markdown = (tags: string[]) => tags.map((tag) =>
    ['.md', '.bubble-user .md', '.bubble-agent .md'].map((root) => scope + root + ' ' + tag).join(','),
  ).join(',')
  const agentHeading = (tags: string[]) => tags.map((tag) => scope + '.bubble-agent .md ' + tag).join(',')
  return `${selectors}{font-size:${body.fontSize * factor}px;line-height:${body.lineHeight * factor}px;}
${markdown(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])}{font-size:1.1em;line-height:1.4;}
${agentHeading(['h1'])}{font-size:1.25em;line-height:1.45;}
${agentHeading(['h2'])}{font-size:1.12em;line-height:1.45;}
${agentHeading(['h3'])}{font-size:1.06em;line-height:1.45;}
${agentHeading(['h4', 'h5', 'h6'])}{font-size:1em;line-height:1.45;}
${markdown(['table', 'pre', 'code'])}{font-size:.9em;line-height:1.5;}`
}
