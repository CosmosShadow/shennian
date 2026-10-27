// @arch docs/architecture/app/chat-draft-storage.md#4.-待确认消息（outbound）
// @test src/__tests__/chat-outbound-storage.test.ts

import { Platform } from 'react-native'
import type { ChatMessage } from '@shennian/shared'
import type { SessionDeliveryState, SessionDurableSendAck } from '@shennian/wire'

const CHAT_OUTBOUND_KEY = 'shennian:chatOutboundMessages:v2'
const MAX_OUTBOUND_AGE_MS = 7 * 24 * 60 * 60 * 1000
const outboundListeners = new Set<() => void>()
const deletedSessionBarriers = new Set<string>()

type NativeStorage = {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
}

export type ChatOutboundDeliveryState =
  | SessionDeliveryState
  | 'local_pending'
  | 'sending'
  | 'unconfirmed'

export type ChatOutboundMessage = ChatMessage & {
  clientMessageId: string
  messageId: string | null
  deliveryState: ChatOutboundDeliveryState
  bodyRevision: number | null
  lastAttemptAt: string
}

type OutboundMap = Record<string, ChatOutboundMessage[]>
type AccountOutboundMap = Record<string, OutboundMap>

function notifyOutboundListeners(): void {
  for (const listener of outboundListeners) listener()
}

export function subscribeChatOutboundMessages(listener: () => void): () => void {
  outboundListeners.add(listener)
  return () => outboundListeners.delete(listener)
}

function parseAttachment(value: unknown): NonNullable<ChatMessage['attachments']>[number] | null {
  if (!value || typeof value !== 'object') return null
  const entry = value as Record<string, unknown>
  const kind =
    entry.kind === 'image' || entry.kind === 'file' || entry.kind === 'folder' ? entry.kind : null
  if (
    typeof entry.path !== 'string' ||
    typeof entry.name !== 'string' ||
    typeof entry.mimeType !== 'string' ||
    !kind
  ) {
    return null
  }
  const byteSize = typeof entry.byteSize === 'number' && Number.isSafeInteger(entry.byteSize)
    ? entry.byteSize
    : null
  const sha256 = typeof entry.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(entry.sha256)
    ? entry.sha256.toLowerCase()
    : null
  if (byteSize === null || byteSize < 0 || !sha256) return null
  return {
    path: entry.path,
    name: entry.name,
    mimeType: entry.mimeType,
    kind,
    byteSize,
    sha256,
  }
}

function parseOutboundMessage(value: unknown): ChatOutboundMessage | null {
  if (!value || typeof value !== 'object') return null
  const entry = value as Record<string, unknown>
  if (
    typeof entry.id !== 'string' ||
    entry.role !== 'user' ||
    typeof entry.ts !== 'number' ||
    typeof entry.content !== 'string'
  ) {
    return null
  }
  if (Date.now() - entry.ts > MAX_OUTBOUND_AGE_MS) return null

  const status =
    entry.status === 'sending' ||
    entry.status === 'sent' ||
    entry.status === 'uncertain' ||
    entry.status === 'error'
      ? entry.status
      : 'sending'
  const deliveryState =
    entry.deliveryState === 'local_pending' ||
    entry.deliveryState === 'queued' ||
    entry.deliveryState === 'committed' ||
    entry.deliveryState === 'executing' ||
    entry.deliveryState === 'completed' ||
    entry.deliveryState === 'failed' ||
    entry.deliveryState === 'cancelled' ||
    entry.deliveryState === 'sending' ||
    entry.deliveryState === 'unconfirmed'
      ? entry.deliveryState
      : status === 'uncertain'
        ? 'unconfirmed'
        : status === 'error'
          ? 'failed'
          : 'sending'

  return {
    id: entry.id,
    role: 'user',
    ts: entry.ts,
    content: entry.content,
    status,
    clientMessageId:
      typeof entry.clientMessageId === 'string' ? entry.clientMessageId : entry.id,
    messageId: typeof entry.messageId === 'string' ? entry.messageId : null,
    deliveryState,
    bodyRevision:
      typeof entry.bodyRevision === 'number' && Number.isSafeInteger(entry.bodyRevision)
        ? entry.bodyRevision
        : null,
    lastAttemptAt:
      typeof entry.lastAttemptAt === 'string' && Number.isFinite(new Date(entry.lastAttemptAt).getTime())
        ? entry.lastAttemptAt
        : new Date(entry.ts).toISOString(),
    ...(typeof entry.queueMessageId === 'string' ? { queueMessageId: entry.queueMessageId } : {}),
    ...(Array.isArray(entry.attachments)
      ? {
          attachments: entry.attachments
            .map(parseAttachment)
            .filter(
              (attachment): attachment is NonNullable<ChatMessage['attachments']>[number] =>
                attachment !== null,
            ),
        }
      : {}),
  }
}

function parseOutboundMap(raw: string | null): AccountOutboundMap {
  if (!raw) return {}
  try {
    const value = JSON.parse(raw) as unknown
    if (!value || typeof value !== 'object') return {}
    const result: AccountOutboundMap = {}
    for (const [accountId, accountValue] of Object.entries(value as Record<string, unknown>)) {
      if (!accountValue || typeof accountValue !== 'object') continue
      const sessions: OutboundMap = {}
      for (const [sessionId, messages] of Object.entries(accountValue as Record<string, unknown>)) {
        if (!Array.isArray(messages)) continue
        const parsed = messages
          .map(parseOutboundMessage)
          .filter((message): message is ChatOutboundMessage => message !== null)
        if (parsed.length) sessions[sessionId] = parsed
      }
      if (Object.keys(sessions).length) result[accountId] = sessions
    }
    return result
  } catch {
    return {}
  }
}

function getWebStorage() {
  if (Platform.OS === 'web' && typeof localStorage !== 'undefined') return localStorage
  return null
}

let nativeStorage: NativeStorage | null = null
let nativeMap: AccountOutboundMap = {}
let nativeHydrated = Platform.OS === 'web'
let nativeHydration: Promise<void> | null = null

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

function readMap(): AccountOutboundMap {
  const webStorage = getWebStorage()
  return webStorage ? parseOutboundMap(webStorage.getItem(CHAT_OUTBOUND_KEY)) : nativeMap
}

let pendingWrite: Promise<void> = Promise.resolve()

export async function flushChatOutboundStorage(): Promise<void> {
  await pendingWrite
}

function persistMap(map: AccountOutboundMap): void {
  const raw = JSON.stringify(map)
  const webStorage = getWebStorage()
  if (webStorage) {
    webStorage.setItem(CHAT_OUTBOUND_KEY, raw)
    return
  }
  nativeMap = map
  nativeHydrated = true
  pendingWrite = pendingWrite.catch(() => {}).then(async () => {
    const storage = await ensureNativeStorage()
    if (!storage) throw new Error('Local message storage is unavailable')
    await storage.setItem(CHAT_OUTBOUND_KEY, raw)
  })
  void pendingWrite.catch(() => {})
}

export async function hydrateChatOutboundStorage(): Promise<void> {
  if (Platform.OS === 'web' || nativeHydrated) return
  if (nativeHydration) return nativeHydration
  nativeHydration = (async () => {
    const store = await ensureNativeStorage()
    const raw = await store?.getItem(CHAT_OUTBOUND_KEY).catch(() => null)
    nativeMap = parseOutboundMap(raw ?? null)
    nativeHydrated = true
    notifyOutboundListeners()
  })().finally(() => {
    nativeHydration = null
  })
  return nativeHydration
}

export function getChatOutboundSessionIds(accountId: string): string[] {
  return Object.keys(readMap()[accountId] ?? {})
}

export function getChatOutboundMessages(accountId: string, sessionId: string): ChatOutboundMessage[] {
  return (readMap()[accountId]?.[sessionId] ?? []).map((message) => ({
    ...message,
    attachments: message.attachments?.map((attachment) => ({ ...attachment })),
  }))
}

export function getLatestSendingChatOutboundPreview(accountId: string, sessionId: string): string {
  const messages = readMap()[accountId]?.[sessionId] ?? []
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if ((message.status === 'sending' || message.status === 'uncertain')
      && ['sending', 'local_pending', 'unconfirmed'].includes(message.deliveryState)) {
      return message.content.trim()
    }
  }
  return ''
}

export function saveChatOutboundMessage(
  accountId: string,
  sessionId: string,
  message: ChatMessage,
  delivery?: Partial<Pick<
    ChatOutboundMessage,
    'clientMessageId' | 'messageId' | 'deliveryState' | 'bodyRevision' | 'lastAttemptAt'
  >>,
): void {
  if (deletedSessionBarriers.has(sessionId)) return
  const map = readMap()
  const accountMessages = map[accountId] ?? {}
  const current = accountMessages[sessionId] ?? []
  const existing = current.find((item) => item.id === message.id)
  const parsed = parseOutboundMessage({
    ...message,
    clientMessageId: delivery?.clientMessageId ?? existing?.clientMessageId ?? message.id,
    messageId: delivery?.messageId ?? existing?.messageId ?? null,
    deliveryState: delivery?.deliveryState ?? existing?.deliveryState ?? 'sending',
    bodyRevision: delivery?.bodyRevision ?? existing?.bodyRevision ?? null,
    lastAttemptAt:
      delivery?.lastAttemptAt ?? existing?.lastAttemptAt ?? new Date(message.ts).toISOString(),
  })
  if (!accountId || !sessionId || !parsed) return
  const next = current.filter((item) => item.id !== parsed.id)
  next.push(parsed)
  persistMap({
    ...map,
    [accountId]: { ...accountMessages, [sessionId]: next.sort((left, right) => left.ts - right.ts) },
  })
  notifyOutboundListeners()
}

export function saveChatOutboundAck(
  accountId: string,
  sessionId: string,
  message: ChatMessage,
  ack: SessionDurableSendAck,
): void {
  if (deletedSessionBarriers.has(sessionId)) return
  // An ACK is an update, never a new send. A canonical commit may have already
  // removed this item while the request was still in flight.
  const current = readMap()[accountId]?.[sessionId]?.find((item) => item.id === message.id)
  if (!current || (current.bodyRevision ?? 0) > ack.bodyRevision) return
  saveChatOutboundMessage(accountId, sessionId, message, {
    clientMessageId: ack.clientMessageId,
    messageId: ack.messageId,
    deliveryState: ack.deliveryState,
    bodyRevision: ack.bodyRevision,
  })
}

export function removeChatOutboundMessage(accountId: string, sessionId: string, messageId: string): void {
  if (!accountId || !sessionId || !messageId) return
  const map = readMap()
  const accountMessages = map[accountId] ?? {}
  const current = accountMessages[sessionId] ?? []
  const next = current.filter((message) => message.id !== messageId)
  if (next.length === current.length) return
  const nextAccountMessages = { ...accountMessages }
  if (next.length) nextAccountMessages[sessionId] = next
  else delete nextAccountMessages[sessionId]
  const nextMap = { ...map }
  if (Object.keys(nextAccountMessages).length) nextMap[accountId] = nextAccountMessages
  else delete nextMap[accountId]
  persistMap(nextMap)
  notifyOutboundListeners()
}

export function removeConfirmedChatOutboundMessages(
  accountId: string,
  sessionId: string,
  confirmedMessageIds: Iterable<string>,
): void {
  const ids = new Set(confirmedMessageIds)
  if (!ids.size) return
  const map = readMap()
  const accountMessages = map[accountId] ?? {}
  const current = accountMessages[sessionId] ?? []
  const next = current.filter((message) =>
    !ids.has(message.id) && !ids.has(message.clientMessageId)
    && (!message.messageId || !ids.has(message.messageId)),
  )
  if (next.length === current.length) return
  const nextAccountMessages = { ...accountMessages }
  if (next.length) nextAccountMessages[sessionId] = next
  else delete nextAccountMessages[sessionId]
  const nextMap = { ...map }
  if (Object.keys(nextAccountMessages).length) nextMap[accountId] = nextAccountMessages
  else delete nextMap[accountId]
  persistMap(nextMap)
  notifyOutboundListeners()
}

export function removeChatOutboundSession(accountId: string, sessionId: string): void {
  const map = readMap()
  const accountMessages = map[accountId]
  if (!accountMessages?.[sessionId]) return
  const nextAccountMessages = { ...accountMessages }
  delete nextAccountMessages[sessionId]
  const nextMap = { ...map }
  if (Object.keys(nextAccountMessages).length) nextMap[accountId] = nextAccountMessages
  else delete nextMap[accountId]
  persistMap(nextMap)
  notifyOutboundListeners()
}

export function markChatOutboundSessionDeleted(sessionId: string): void {
  if (sessionId) deletedSessionBarriers.add(sessionId)
}

export function clearChatOutboundAccount(accountId: string): void {
  if (!accountId) return
  const map = readMap()
  if (!map[accountId]) return
  const nextMap = { ...map }
  delete nextMap[accountId]
  persistMap(nextMap)
  notifyOutboundListeners()
}

export async function clearAllChatOutboundMessages(): Promise<void> {
  deletedSessionBarriers.clear()
  nativeMap = {}
  nativeHydrated = true
  const webStorage = getWebStorage()
  if (webStorage) webStorage.setItem(CHAT_OUTBOUND_KEY, '{}')
  else {
    const store = await ensureNativeStorage()
    await store?.setItem(CHAT_OUTBOUND_KEY, '{}')
  }
  notifyOutboundListeners()
}
