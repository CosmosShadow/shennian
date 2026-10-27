// @arch docs/architecture/app/chat-draft-storage.md
// @test src/__tests__/chat-draft-storage.test.ts

import { Platform } from 'react-native'
import { trimPreviewText } from '@shennian/shared'
import type { ChatAttachmentMeta } from '@shennian/wire'

export type ChatDraft = {
  text: string
  attachments: ChatAttachmentMeta[]
}

const CHAT_DRAFTS_KEY = 'shennian:chatDrafts:v2'
const WEB_PERSIST_DELAY_MS = 150
const draftListeners = new Set<() => void>()
const scopedDraftListeners = new Map<string, Set<() => void>>()

type ChatDraftMap = Record<string, ChatDraft>
type AccountChatDraftMap = Record<string, ChatDraftMap>

type NativeStorage = {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
}

function draftListenerKey(accountId: string, sessionId: string): string {
  return `${accountId}\u0000${sessionId}`
}

function notifyDraftListeners(accountId?: string, sessionId?: string): void {
  for (const listener of draftListeners) {
    listener()
  }
  if (!accountId || !sessionId) {
    for (const listeners of scopedDraftListeners.values()) {
      for (const listener of listeners) listener()
    }
    return
  }
  for (const listener of scopedDraftListeners.get(draftListenerKey(accountId, sessionId)) ?? []) {
    listener()
  }
}

function parseAttachment(value: unknown): ChatAttachmentMeta | null {
  if (typeof value !== 'object' || value === null) return null

  const entry = value as Record<string, unknown>
  const path = typeof entry.path === 'string' ? entry.path : ''
  const name = typeof entry.name === 'string' ? entry.name : ''
  const mimeType = typeof entry.mimeType === 'string' ? entry.mimeType : ''
  const kind =
    entry.kind === 'image' || entry.kind === 'file' || entry.kind === 'folder'
      ? entry.kind
      : null
  const byteSize = typeof entry.byteSize === 'number' && Number.isSafeInteger(entry.byteSize)
    ? entry.byteSize
    : null
  const sha256 = typeof entry.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(entry.sha256)
    ? entry.sha256.toLowerCase()
    : null

  if (!path || !name || !mimeType || !kind || byteSize === null || byteSize < 0 || !sha256) return null
  return { path, name, mimeType, kind, byteSize, sha256 }
}

function parseChatDraft(value: unknown): ChatDraft | null {
  if (typeof value !== 'object' || value === null) return null

  const entry = value as Record<string, unknown>
  const text = typeof entry.text === 'string' ? entry.text : ''
  const attachments = Array.isArray(entry.attachments)
    ? entry.attachments
        .map((attachment) => parseAttachment(attachment))
        .filter((attachment): attachment is ChatAttachmentMeta => attachment !== null)
    : []

  return { text, attachments }
}

function parseChatDraftMap(raw: string | null): AccountChatDraftMap {
  if (!raw) return {}

  try {
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== 'object' || parsed === null) return {}

    const map: AccountChatDraftMap = {}
    for (const [accountId, accountDrafts] of Object.entries(parsed as Record<string, unknown>)) {
      if (!accountDrafts || typeof accountDrafts !== 'object') continue
      const drafts: ChatDraftMap = {}
      for (const [sessionId, draft] of Object.entries(accountDrafts as Record<string, unknown>)) {
        const parsedDraft = parseChatDraft(draft)
        if (!parsedDraft) continue
        drafts[sessionId] = parsedDraft
      }
      if (Object.keys(drafts).length) map[accountId] = drafts
    }
    return map
  } catch {
    return {}
  }
}

function cloneDraft(draft: ChatDraft): ChatDraft {
  return {
    text: draft.text,
    attachments: draft.attachments.map((attachment) => ({ ...attachment })),
  }
}

export function subscribeChatDrafts(listener: () => void): () => void {
  draftListeners.add(listener)
  return () => {
    draftListeners.delete(listener)
  }
}

/** Subscribe one preview row without waking every mounted conversation while typing. */
export function subscribeChatDraft(
  accountId: string,
  sessionId: string,
  listener: () => void,
): () => void {
  const key = draftListenerKey(accountId, sessionId)
  const listeners = scopedDraftListeners.get(key) ?? new Set<() => void>()
  listeners.add(listener)
  scopedDraftListeners.set(key, listeners)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) scopedDraftListeners.delete(key)
  }
}

function areDraftsEqual(left: ChatDraft | null | undefined, right: ChatDraft): boolean {
  if (!left) return false
  if (left.text !== right.text) return false
  if (left.attachments.length !== right.attachments.length) return false

  return left.attachments.every((attachment, index) => {
    const other = right.attachments[index]
    return (
      attachment.path === other.path &&
      attachment.name === other.name &&
      attachment.mimeType === other.mimeType &&
      attachment.kind === other.kind &&
      attachment.byteSize === other.byteSize &&
      attachment.sha256 === other.sha256
    )
  })
}

function getDraftStorage(): {
  get(key: string): string | null
  set(key: string, value: string): void
} {
  if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
    return {
      get: (key) => localStorage.getItem(key),
      set: (key, value) => localStorage.setItem(key, value),
    }
  }

  const store: Record<string, string> = {}
  return {
    get: (key) => store[key] ?? null,
    set: (key, value) => {
      store[key] = value
    },
  }
}

const storage = getDraftStorage()
let nativeStorage: NativeStorage | null = null
let nativeDraftMap: AccountChatDraftMap = {}
let webDraftMap: AccountChatDraftMap = Platform.OS === 'web'
  ? parseChatDraftMap(storage.get(CHAT_DRAFTS_KEY))
  : {}
let webPersistTimer: ReturnType<typeof setTimeout> | null = null
let nativeHydrated = Platform.OS === 'web'
let nativeHydration: Promise<void> | null = null

export function flushChatDraftStorage(): void {
  if (Platform.OS !== 'web') return
  if (webPersistTimer) {
    clearTimeout(webPersistTimer)
    webPersistTimer = null
  }
  storage.set(CHAT_DRAFTS_KEY, JSON.stringify(webDraftMap))
}

function scheduleWebPersist(): void {
  if (webPersistTimer) clearTimeout(webPersistTimer)
  webPersistTimer = setTimeout(flushChatDraftStorage, WEB_PERSIST_DELAY_MS)
}

if (Platform.OS === 'web' && typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushChatDraftStorage)
}

async function ensureNativeStorage(): Promise<NativeStorage | null> {
  if (Platform.OS === 'web') return null
  if (nativeStorage) return nativeStorage

  try {
    const mod = await import('@react-native-async-storage/async-storage')
    nativeStorage = mod.default as NativeStorage
  } catch {
    nativeStorage = null
  }

  return nativeStorage
}

function getNativeStorage(): NativeStorage | null {
  if (Platform.OS === 'web') return null
  return nativeStorage
}

function readChatDraftMap(): AccountChatDraftMap {
  if (Platform.OS !== 'web') return nativeDraftMap
  return webDraftMap
}

function persistChatDraftMap(map: AccountChatDraftMap): void {
  if (Platform.OS === 'web') {
    webDraftMap = map
    scheduleWebPersist()
    return
  }

  const raw = JSON.stringify(map)
  nativeDraftMap = map
  nativeHydrated = true
  const store = getNativeStorage()
  if (!store) return
  void store.setItem(CHAT_DRAFTS_KEY, raw).catch(() => {})
}

export async function hydrateChatDraftStorage(): Promise<void> {
  if (Platform.OS === 'web' || nativeHydrated) return
  if (nativeHydration) return nativeHydration

  nativeHydration = (async () => {
    const store = await ensureNativeStorage()
    if (!store) {
      nativeDraftMap = {}
      nativeHydrated = true
      return
    }

    const raw = await store.getItem(CHAT_DRAFTS_KEY).catch(() => null)
    nativeDraftMap = parseChatDraftMap(raw)
    nativeHydrated = true
    notifyDraftListeners()
  })().finally(() => {
    nativeHydration = null
  })

  return nativeHydration
}

export function getChatDraft(accountId: string, sessionId: string): ChatDraft | null {
  if (!accountId || !sessionId) return null

  try {
    const draft = readChatDraftMap()[accountId]?.[sessionId]
    return draft ? cloneDraft(draft) : null
  } catch {
    return null
  }
}

export function getChatDraftPreview(accountId: string, sessionId: string): string {
  const text = getChatDraft(accountId, sessionId)?.text ?? ''
  return text.trim() ? trimPreviewText(text) : ''
}

export function saveChatDraft(accountId: string, sessionId: string, draft: ChatDraft): void {
  if (!accountId || !sessionId) return

  try {
    const normalized = cloneDraft({
      text: typeof draft.text === 'string' ? draft.text : '',
      attachments: Array.isArray(draft.attachments)
        ? draft.attachments
            .map((attachment) => parseAttachment(attachment))
            .filter((attachment): attachment is ChatAttachmentMeta => attachment !== null)
        : [],
    })

    const map = readChatDraftMap()
    const accountDrafts = map[accountId] ?? {}
    const hasContent = normalized.text.length > 0 || normalized.attachments.length > 0
    if (!hasContent) {
      if (!accountDrafts[sessionId]) return
      const nextAccountDrafts = { ...accountDrafts }
      delete nextAccountDrafts[sessionId]
      const nextMap = { ...map }
      if (Object.keys(nextAccountDrafts).length) nextMap[accountId] = nextAccountDrafts
      else delete nextMap[accountId]
      persistChatDraftMap(nextMap)
      notifyDraftListeners(accountId, sessionId)
      return
    }

    if (areDraftsEqual(accountDrafts[sessionId], normalized)) return
    persistChatDraftMap({
      ...map,
      [accountId]: { ...accountDrafts, [sessionId]: normalized },
    })
    notifyDraftListeners(accountId, sessionId)
  } catch {
    // noop
  }
}

export function removeChatDraft(accountId: string, sessionId: string): void {
  if (!accountId || !sessionId) return

  try {
    const map = readChatDraftMap()
    const accountDrafts = map[accountId]
    if (!accountDrafts?.[sessionId]) return
    const nextAccountDrafts = { ...accountDrafts }
    delete nextAccountDrafts[sessionId]
    const nextMap = { ...map }
    if (Object.keys(nextAccountDrafts).length) nextMap[accountId] = nextAccountDrafts
    else delete nextMap[accountId]
    persistChatDraftMap(nextMap)
    notifyDraftListeners(accountId, sessionId)
  } catch {
    // noop
  }
}

export function clearChatDraftAccount(accountId: string): void {
  if (!accountId) return
  try {
    const map = readChatDraftMap()
    if (!map[accountId]) return
    const nextMap = { ...map }
    delete nextMap[accountId]
    persistChatDraftMap(nextMap)
    notifyDraftListeners()
  } catch {
    // noop
  }
}

export async function clearAllChatDrafts(): Promise<void> {
  nativeDraftMap = {}
  webDraftMap = {}
  nativeHydrated = true
  if (Platform.OS === 'web') {
    flushChatDraftStorage()
  } else {
    const store = await ensureNativeStorage()
    await store?.setItem(CHAT_DRAFTS_KEY, '{}')
  }
  notifyDraftListeners()
}
