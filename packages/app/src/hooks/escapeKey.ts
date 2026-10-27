// @arch docs/architecture/app/chat-attachments-preview.md
// @test packages/app/src/__tests__/escape-key.test.ts

type EscapeHandler = () => void

type EscapeEntry = {
  id: number
  enabled: boolean
  includeEditable: boolean
  handler: EscapeHandler
}

export type EscapeKeyEventLike = {
  key?: string
  defaultPrevented?: boolean
  target?: unknown
  preventDefault?: () => void
  stopPropagation?: () => void
}

let nextEntryId = 1
const escapeStack: EscapeEntry[] = []
let listening = false

function getDocument(): Document | null {
  return typeof document === 'undefined' ? null : document
}

export function isEscapeEditableTarget(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false

  const node = target as {
    tagName?: string
    isContentEditable?: boolean
    getAttribute?: (name: string) => string | null
    closest?: (selector: string) => unknown
  }

  if (node.isContentEditable) return true

  const tagName = typeof node.tagName === 'string' ? node.tagName.toLowerCase() : ''
  if (tagName === 'textarea' || tagName === 'select') return true
  if (tagName === 'input') return true

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

export function dispatchEscapeKey(event: EscapeKeyEventLike): boolean {
  if (event.defaultPrevented || event.key !== 'Escape') return false
  const editable = isEscapeEditableTarget(event.target)

  for (let index = escapeStack.length - 1; index >= 0; index -= 1) {
    const entry = escapeStack[index]
    if (!entry.enabled) continue
    // Editable controls keep Escape for their own interaction unless the
    // topmost overlay explicitly owns dismissal from every focused control.
    if (editable && !entry.includeEditable) return false
    event.preventDefault?.()
    event.stopPropagation?.()
    entry.handler()
    return true
  }

  return false
}

function handleDocumentKeyDown(event: KeyboardEvent) {
  dispatchEscapeKey(event)
}

function ensureDocumentListener() {
  const doc = getDocument()
  if (!doc || listening) return
  doc.addEventListener('keydown', handleDocumentKeyDown, true)
  listening = true
}

function removeDocumentListenerIfIdle() {
  const doc = getDocument()
  if (!doc || !listening || escapeStack.length > 0) return
  doc.removeEventListener('keydown', handleDocumentKeyDown, true)
  listening = false
}

export function registerEscapeHandler(
  handler: EscapeHandler,
  enabled = true,
  options: { includeEditable?: boolean } = {},
): () => void {
  const entry: EscapeEntry = {
    id: nextEntryId,
    enabled,
    includeEditable: options.includeEditable ?? false,
    handler,
  }
  nextEntryId += 1
  escapeStack.push(entry)
  ensureDocumentListener()

  return () => {
    const index = escapeStack.findIndex((item) => item.id === entry.id)
    if (index >= 0) escapeStack.splice(index, 1)
    removeDocumentListenerIfIdle()
  }
}

export function getEscapeStackSizeForTest(): number {
  return escapeStack.length
}

export function resetEscapeHandlersForTest(): void {
  escapeStack.splice(0, escapeStack.length)
  removeDocumentListenerIfIdle()
}
