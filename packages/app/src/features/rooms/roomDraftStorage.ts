// @arch docs/features/network-rooms/local-first-persistence.md#本机草稿
// @test src/__tests__/room-draft-storage.test.ts

import { Platform } from 'react-native'
import { trimPreviewText } from '@shennian/shared'

export type StoredRoomDraftAttachment = {
  attachmentId: string
  name: string
  mimeType: string
  size: number
}

export type RoomDraft = {
  text: string
  attachments: StoredRoomDraftAttachment[]
  mentionMembershipIds: string[]
}

const STORAGE_KEY = 'shennian:roomDrafts:v1'
const WEB_PERSIST_DELAY_MS = 150
const listeners = new Set<() => void>()
const scopedListeners = new Map<string, Set<() => void>>()
type DraftMap = Record<string, Record<string, RoomDraft>>
type NativeStorage = {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
}

let drafts: DraftMap = {}
let nativeStorage: NativeStorage | null = null
let hydrated = false
let hydration: Promise<void> | null = null
let webPersistTimer: ReturnType<typeof setTimeout> | null = null

function listenerKey(accountId: string, roomId: string): string {
  return `${accountId}\u0000${roomId}`
}

function notify(accountId?: string, roomId?: string): void {
  for (const listener of listeners) listener()
  if (!accountId || !roomId) {
    for (const roomListeners of scopedListeners.values()) {
      for (const listener of roomListeners) listener()
    }
    return
  }
  for (const listener of scopedListeners.get(listenerKey(accountId, roomId)) ?? []) listener()
}

function parseAttachment(value: unknown): StoredRoomDraftAttachment | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  if (
    typeof item.attachmentId !== 'string' ||
    !item.attachmentId ||
    typeof item.name !== 'string' ||
    !item.name ||
    typeof item.mimeType !== 'string' ||
    !item.mimeType ||
    typeof item.size !== 'number' ||
    !Number.isFinite(item.size) ||
    item.size < 0
  )
    return null
  return {
    attachmentId: item.attachmentId,
    name: item.name,
    mimeType: item.mimeType,
    size: item.size,
  }
}

function parseDraft(value: unknown): RoomDraft | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  return {
    text: typeof item.text === 'string' ? item.text : '',
    attachments: Array.isArray(item.attachments)
      ? item.attachments
          .map(parseAttachment)
          .filter((entry): entry is StoredRoomDraftAttachment => Boolean(entry))
      : [],
    mentionMembershipIds: Array.isArray(item.mentionMembershipIds)
      ? item.mentionMembershipIds.filter(
          (id): id is string => typeof id === 'string' && Boolean(id),
        )
      : [],
  }
}

function parseMap(raw: string | null): DraftMap {
  if (!raw) return {}
  try {
    const value = JSON.parse(raw) as unknown
    if (!value || typeof value !== 'object') return {}
    const result: DraftMap = {}
    for (const [accountId, rooms] of Object.entries(value as Record<string, unknown>)) {
      if (!rooms || typeof rooms !== 'object') continue
      for (const [roomId, value] of Object.entries(rooms as Record<string, unknown>)) {
        const draft = parseDraft(value)
        if (!draft) continue
        ;(result[accountId] ??= {})[roomId] = draft
      }
    }
    return result
  } catch {
    return {}
  }
}

async function storage(): Promise<NativeStorage | null> {
  if (Platform.OS === 'web') return null
  if (nativeStorage) return nativeStorage
  try {
    nativeStorage = (await import('@react-native-async-storage/async-storage')).default
  } catch {
    nativeStorage = null
  }
  return nativeStorage
}

export function flushRoomDraftStorage(): void {
  if (Platform.OS !== 'web' || typeof localStorage === 'undefined') return
  if (webPersistTimer) {
    clearTimeout(webPersistTimer)
    webPersistTimer = null
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts))
}

function persist(): void {
  if (Platform.OS === 'web') {
    if (webPersistTimer) clearTimeout(webPersistTimer)
    webPersistTimer = setTimeout(flushRoomDraftStorage, WEB_PERSIST_DELAY_MS)
    return
  }
  void storage()
    .then((store) => store?.setItem(STORAGE_KEY, JSON.stringify(drafts)))
    .catch(() => {})
}

if (Platform.OS === 'web' && typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushRoomDraftStorage)
}

function clone(draft: RoomDraft): RoomDraft {
  return {
    text: draft.text,
    attachments: draft.attachments.map((item) => ({ ...item })),
    mentionMembershipIds: [...draft.mentionMembershipIds],
  }
}

function areDraftsEqual(left: RoomDraft | undefined, right: RoomDraft): boolean {
  if (!left || left.text !== right.text) return false
  if (left.attachments.length !== right.attachments.length) return false
  if (left.mentionMembershipIds.length !== right.mentionMembershipIds.length) return false
  return (
    left.attachments.every((attachment, index) => {
      const other = right.attachments[index]
      return (
        attachment.attachmentId === other.attachmentId &&
        attachment.name === other.name &&
        attachment.mimeType === other.mimeType &&
        attachment.size === other.size
      )
    }) &&
    left.mentionMembershipIds.every(
      (membershipId, index) => membershipId === right.mentionMembershipIds[index],
    )
  )
}

export async function hydrateRoomDraftStorage(): Promise<void> {
  if (hydrated) return
  if (hydration) return hydration
  hydration = (async () => {
    if (Platform.OS === 'web') {
      drafts = parseMap(
        typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY),
      )
      hydrated = true
      notify()
      return
    }
    const store = await storage()
    drafts = parseMap((await store?.getItem(STORAGE_KEY).catch(() => null)) ?? null)
    hydrated = true
    notify()
  })().finally(() => {
    hydration = null
  })
  return hydration
}

export function subscribeRoomDrafts(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Subscribe one Room preview instead of invalidating the complete Room list. */
export function subscribeRoomDraft(
  accountId: string,
  roomId: string,
  listener: () => void,
): () => void {
  const key = listenerKey(accountId, roomId)
  const roomListeners = scopedListeners.get(key) ?? new Set<() => void>()
  roomListeners.add(listener)
  scopedListeners.set(key, roomListeners)
  return () => {
    roomListeners.delete(listener)
    if (roomListeners.size === 0) scopedListeners.delete(key)
  }
}

export function getRoomDraft(accountId: string, roomId: string): RoomDraft | null {
  if (!accountId || !roomId) return null
  const value = drafts[accountId]?.[roomId]
  return value ? clone(value) : null
}

export function getRoomDraftPreview(accountId: string, roomId: string, active = false): string {
  if (active) return ''
  const value = drafts[accountId]?.[roomId]
  return value?.text.trim()
    ? trimPreviewText(value.text)
    : value?.attachments.length
      ? '[File]'
      : ''
}

export function saveRoomDraft(accountId: string, roomId: string, draft: RoomDraft): void {
  if (!accountId || !roomId) return
  const normalized = parseDraft(draft)
  if (!normalized) return
  const hasContent = Boolean(normalized.text || normalized.attachments.length)
  if (!hasContent) {
    removeRoomDraft(accountId, roomId)
    return
  }
  if (areDraftsEqual(drafts[accountId]?.[roomId], normalized)) return
  drafts = {
    ...drafts,
    [accountId]: { ...(drafts[accountId] ?? {}), [roomId]: normalized },
  }
  persist()
  notify(accountId, roomId)
}

export function removeRoomDraft(accountId: string, roomId: string): void {
  const account = drafts[accountId]
  if (!account?.[roomId]) return
  const nextAccount = { ...account }
  delete nextAccount[roomId]
  drafts = { ...drafts }
  if (Object.keys(nextAccount).length) drafts[accountId] = nextAccount
  else delete drafts[accountId]
  persist()
  notify(accountId, roomId)
}

export function clearRoomDraftAccount(accountId: string): void {
  if (!drafts[accountId]) return
  drafts = { ...drafts }
  delete drafts[accountId]
  persist()
  notify()
}

export async function clearAllRoomDrafts(): Promise<void> {
  drafts = {}
  hydrated = true
  if (Platform.OS === 'web') {
    flushRoomDraftStorage()
  } else {
    await (await storage())?.setItem(STORAGE_KEY, '{}')
  }
  notify()
}
