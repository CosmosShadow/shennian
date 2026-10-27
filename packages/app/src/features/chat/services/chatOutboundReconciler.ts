// @arch docs/architecture/app/chat-draft-storage.md#4.-待确认消息（outbound）
// @test src/__tests__/chat-outbound-storage.test.ts

import type { SessionMessageStatusResponse } from '@shennian/wire'
import type { PersonalSessionBodyStore } from '../../../storage/personal-session-body-store.native'
import {
  getChatOutboundMessages,
  getChatOutboundSessionIds,
  removeConfirmedChatOutboundMessages,
  saveChatOutboundAck,
  saveChatOutboundMessage,
  subscribeChatOutboundMessages,
  type ChatOutboundMessage,
} from '../utils/outboundStorage'

type Options = {
  accountId: string
  store: Pick<PersonalSessionBodyStore, 'getMessages' | 'subscribe'>
  isActive: () => boolean
  onRecovered?: (sessionId: string, message: ChatOutboundMessage) => void
  queryStatus: (sessionId: string, message: ChatOutboundMessage) => Promise<SessionMessageStatusResponse>
}

/** App-owned recovery; no transcript window, route or active-chat dependency. */
export class ChatOutboundReconciler {
  private stopped = false
  private running: Promise<void> | null = null
  private subscriptions = new Map<string, () => void>()
  private retries = new Map<string, { attempts: number; at: number }>()
  private unsubscribe: () => void
  private timer: ReturnType<typeof setInterval>

  constructor(private options: Options) {
    this.unsubscribe = subscribeChatOutboundMessages(() => {
      this.refreshSubscriptions()
      void this.request()
    })
    this.refreshSubscriptions()
    this.timer = setInterval(() => void this.request(), 15_000)
    void this.request()
  }

  private refreshSubscriptions(): void {
    const ids = new Set(getChatOutboundSessionIds(this.options.accountId))
    for (const [id, unsubscribe] of this.subscriptions) {
      if (!ids.has(id)) {
        unsubscribe()
        this.subscriptions.delete(id)
      }
    }
    for (const id of ids) {
      if (!this.subscriptions.has(id)) {
        this.subscriptions.set(id, this.options.store.subscribe(this.options.accountId, id, () => {
          // Commit reconciliation must not wait for a slow/lost network response.
          void this.confirmLocal(id).catch(() => {})
        }))
      }
    }
    const pendingIds = new Set<string>()
    for (const id of ids) {
      for (const message of getChatOutboundMessages(this.options.accountId, id)) {
        pendingIds.add(`${id}\0${message.id}`)
      }
    }
    for (const key of this.retries.keys()) if (!pendingIds.has(key)) this.retries.delete(key)
  }

  private async confirmLocal(sessionId: string): Promise<void> {
    const { accountId, store } = this.options
    const pending = getChatOutboundMessages(accountId, sessionId)
    // Bound SQLite parameters and read only outstanding identities, not history windows.
    for (let offset = 0; offset < pending.length; offset += 100) {
      const batch = pending.slice(offset, offset + 100)
      const messageIds = new Set<string>()
      for (const message of batch) {
        messageIds.add(message.id)
        messageIds.add(message.clientMessageId)
        if (message.messageId) messageIds.add(message.messageId)
      }
      const messages = await store.getMessages(accountId, sessionId, { messageIds: [...messageIds] })
      if (this.stopped || !this.options.isActive()) return
      removeConfirmedChatOutboundMessages(accountId, sessionId, messages.filter((m) => m.role === 'user').map((m) => m.id))
    }
  }

  request(resetBackoff = false): Promise<void> {
    if (this.stopped || !this.options.isActive()) return Promise.resolve()
    if (resetBackoff) this.retries.clear()
    if (this.running) return this.running
    // Defer so mutations from reconciliation see the single-flight guard.
    this.running = Promise.resolve().then(async () => {
      const ids = getChatOutboundSessionIds(this.options.accountId)
      let cursor = 0
      const worker = async () => {
        while (cursor < ids.length && !this.stopped && this.options.isActive()) {
          const id = ids[cursor++]
          try { await this.reconcileSession(id) } catch { /* retry on the next tick */ }
        }
      }
      await Promise.all([worker(), worker()])
    }).finally(() => { this.running = null })
    return this.running
  }

  private async reconcileSession(sessionId: string): Promise<void> {
    await this.confirmLocal(sessionId)
    const { accountId } = this.options
    for (const message of getChatOutboundMessages(accountId, sessionId)) {
      if (this.stopped || !this.options.isActive()) return
      // This service only confirms delivery; it never submits or retries a send.
      if (['local_pending', 'completed', 'failed', 'cancelled'].includes(message.deliveryState)) continue
      const key = `${sessionId}\0${message.id}`
      const retry = this.retries.get(key)
      if (retry && retry.at > Date.now()) continue
      const attempts = (retry?.attempts ?? 0) + 1
      this.retries.set(key, { attempts, at: Date.now() + Math.min(15_000 * 2 ** Math.min(attempts - 1, 4), 240_000) })
      try {
        const status = await this.options.queryStatus(sessionId, message)
        if (this.stopped || !this.options.isActive()) return
        const current = getChatOutboundMessages(accountId, sessionId).find((m) => m.id === message.id)
        if (!current) continue
        // A concurrent ACK/retry is newer than the query's input snapshot.
        if (current.bodyRevision !== message.bodyRevision || current.lastAttemptAt !== message.lastAttemptAt
          || current.deliveryState !== message.deliveryState) continue
        if (status.state === 'not_found') {
          if (current.messageId) continue
          const recovered = { ...current, status: 'uncertain' as const, deliveryState: 'unconfirmed' as const }
          saveChatOutboundMessage(accountId, sessionId, recovered, { deliveryState: 'unconfirmed' })
          this.options.onRecovered?.(sessionId, recovered)
        } else {
          const failed = status.deliveryState === 'failed' || status.deliveryState === 'cancelled'
          if ((current.bodyRevision ?? 0) > status.bodyRevision) continue
          saveChatOutboundAck(accountId, sessionId, {
            ...current, status: failed ? 'error' : status.deliveryState === 'queued' ? 'sending' : 'sent',
          }, status)
          const recovered = getChatOutboundMessages(accountId, sessionId).find((m) => m.id === current.id)
          if (recovered) this.options.onRecovered?.(sessionId, recovered)
        }
      } catch { /* Offline or unsupported daemon: retain the message, never infer failure. */ }
    }
  }

  stop(): void {
    this.stopped = true
    clearInterval(this.timer)
    this.unsubscribe()
    for (const unsubscribe of this.subscriptions.values()) unsubscribe()
    this.subscriptions.clear()
    this.retries.clear()
  }
}
