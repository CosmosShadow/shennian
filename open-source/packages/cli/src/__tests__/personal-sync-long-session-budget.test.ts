// @arch open-source/docs/cli-runtime.md
// @covers src/session/canonical-store.ts
// @covers src/session/history-subscriptions.ts

import type { Envelope } from '@shennian/wire'
import { describe, expect, it, vi } from 'vitest'
import type { CanonicalSessionStore } from '../session/canonical-store.js'
import { PersonalHistorySubscriptions } from '../session/history-subscriptions.js'

vi.mock('../personal-sync/identity.js', () => ({
  getDaemonInstallationId: () => 'fixture-installation',
}))

describe('long personal session transport budget', () => {
  it('bounds a 2,000-revision canonical session to the requested visible window', () => {
    const messages = Array.from({ length: 120 }, (_, offset) => {
      const index = 1_881 + offset
      const message: Envelope = {
        id: `message-${String(index).padStart(4, '0')}`,
        sessionId: 'long-session',
        role: index % 2 === 0 ? 'agent' : 'user',
        ts: index,
        payload: `bounded fixture message ${index} ${'x'.repeat(80)}`,
      }
      return { sequence: index, revision: index, message }
    })
    const store = {
      daemonInstallationId: 'fixture-installation',
      subscribe: vi.fn(() => vi.fn()),
      readPage: vi.fn(() => ({
        bodyRevision: 2_000,
        firstAvailableSeq: 1,
        lastAvailableSeq: 2_000,
        hasOlder: true,
        messages: messages.map((entry) => entry.message),
        entries: messages,
      })),
    } as unknown as CanonicalSessionStore
    const responses: unknown[] = []
    const subscriptions = new PersonalHistorySubscriptions({
      sendRes: (frame) => responses.push(frame),
      sendEvent: vi.fn(),
    }, store, () => true)

    subscriptions.handleOpen({
      type: 'req', id: 'long-open', method: 'session.history.open',
      params: {
        protocolVersion: 2, dataEpoch: 2, daemonInstallationId: 'fixture-installation',
        sessionId: 'long-session', subscriptionId: 'long-subscription', limit: 120,
      },
    })

    const payload = (responses[0] as { payload: { messages: unknown[]; hasOlder: boolean; snapshotRevision: number } }).payload
    const publicBytes = Buffer.byteLength(JSON.stringify(responses[0]), 'utf8')
    expect(payload).toMatchObject({ hasOlder: true, snapshotRevision: 2_000 })
    expect(payload.messages).toHaveLength(120)
    expect(store.readPage).toHaveBeenCalledWith('long-session', { limit: 120 })
    expect(publicBytes).toBeLessThan(64 * 1024)
    subscriptions.closeAll()
  })
})
