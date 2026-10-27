// @arch docs/architecture/app/chat-attachments-preview.md
// @test packages/app/src/__tests__/keyboard-shortcuts.test.ts

type ShortcutHandler = () => void

export type ShortcutCombo = {
  key: string
  metaOrCtrl?: boolean
  shift?: boolean
  allowEditable?: boolean
  ignoreWidgets?: boolean
}

type ShortcutEntry = {
  id: number
  enabled: boolean
  combo: ShortcutCombo
  handler: ShortcutHandler
}

export type ShortcutKeyEventLike = {
  key?: string
  code?: string
  metaKey?: boolean
  ctrlKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
  defaultPrevented?: boolean
  target?: unknown
  preventDefault?: () => void
  stopPropagation?: () => void
}

let nextEntryId = 1
const shortcutStack: ShortcutEntry[] = []
let listening = false

function getDocument(): Document | null {
  return typeof document === 'undefined' ? null : document
}

export function isShortcutEditableTarget(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false

  const node = target as {
    tagName?: string
    isContentEditable?: boolean
    getAttribute?: (name: string) => string | null
    closest?: (selector: string) => unknown
  }

  if (node.isContentEditable) return true

  const tagName = typeof node.tagName === 'string' ? node.tagName.toLowerCase() : ''
  if (tagName === 'textarea' || tagName === 'select' || tagName === 'input') return true

  if (typeof node.getAttribute === 'function') {
    const role = node.getAttribute('role')?.toLowerCase()
    if (role === 'textbox' || role === 'searchbox' || role === 'combobox') return true
    if (node.getAttribute('contenteditable') === 'true') return true
  }

  if (typeof node.closest === 'function') {
    const editableSelector = [
      'input',
      'textarea',
      'select',
      '[contenteditable="true"]',
      '[role="textbox"]',
      '[role="searchbox"]',
      '[role="combobox"]',
    ].join(', ')
    return Boolean(node.closest(editableSelector))
  }

  return false
}

function normalizeKey(key: string | undefined, code?: string): string {
  if (key === 'Esc') return 'escape'
  if (key === ' ') return 'space'
  if (key && key !== 'Unidentified') return key.toLowerCase()
  if (code === 'Slash') return '/'
  if (code === 'ArrowUp') return 'arrowup'
  if (code === 'ArrowDown') return 'arrowdown'
  if (code === 'Enter') return 'enter'
  return ''
}

export function matchesShortcut(event: ShortcutKeyEventLike, combo: ShortcutCombo): boolean {
  if (event.defaultPrevented) return false
  if (!combo.allowEditable && isShortcutEditableTarget(event.target)) return false
  if (combo.ignoreWidgets) {
    const target = event.target as { closest?: (selector: string) => unknown } | null
    if (
      target?.closest?.(
        '[role="menu"], [role="dialog"], [aria-modal="true"], [role="radiogroup"], [role="tablist"]',
      )
    )
      return false
    // Modal focus can still be on its trigger during the opening frame.
    const overlays = getDocument()?.querySelectorAll(
      '[role="menu"], [role="dialog"], [aria-modal="true"]',
    )
    if (overlays && Array.from(overlays).some((element) => element.getClientRects().length > 0))
      return false
  }

  const expectedKey = combo.key.toLowerCase()
  const actualKey = normalizeKey(event.key, event.code)
  const keyMatches = actualKey === expectedKey || (expectedKey === '/' && event.code === 'Slash')
  if (!keyMatches) return false

  if (combo.metaOrCtrl && !(event.metaKey || event.ctrlKey)) return false
  if (!combo.metaOrCtrl && (event.metaKey || event.ctrlKey)) return false
  if (Boolean(combo.shift) !== Boolean(event.shiftKey)) return false
  if (event.altKey) return false

  return true
}

export function dispatchShortcutKey(event: ShortcutKeyEventLike): boolean {
  for (let index = shortcutStack.length - 1; index >= 0; index -= 1) {
    const entry = shortcutStack[index]
    if (!entry.enabled || !matchesShortcut(event, entry.combo)) continue
    event.preventDefault?.()
    event.stopPropagation?.()
    entry.handler()
    return true
  }
  return false
}

function handleDocumentKeyDown(event: KeyboardEvent) {
  dispatchShortcutKey(event)
}

function ensureDocumentListener() {
  const doc = getDocument()
  if (!doc || listening) return
  doc.addEventListener('keydown', handleDocumentKeyDown, true)
  listening = true
}

function removeDocumentListenerIfIdle() {
  const doc = getDocument()
  if (!doc || !listening || shortcutStack.length > 0) return
  doc.removeEventListener('keydown', handleDocumentKeyDown, true)
  listening = false
}

export function registerShortcutHandler(
  combo: ShortcutCombo,
  handler: ShortcutHandler,
  enabled = true,
): () => void {
  const entry: ShortcutEntry = { id: nextEntryId, enabled, combo, handler }
  nextEntryId += 1
  shortcutStack.push(entry)
  ensureDocumentListener()

  return () => {
    const index = shortcutStack.findIndex((item) => item.id === entry.id)
    if (index >= 0) shortcutStack.splice(index, 1)
    removeDocumentListenerIfIdle()
  }
}

export function getShortcutStackSizeForTest(): number {
  return shortcutStack.length
}

export function resetShortcutHandlersForTest(): void {
  shortcutStack.splice(0, shortcutStack.length)
  removeDocumentListenerIfIdle()
}
