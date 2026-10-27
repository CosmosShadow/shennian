// @arch docs/features/listening.md
// @test src/__tests__/listening-policy.test.ts
import type { ChatMessage } from '@shennian/shared'
export function boundedListeningContext(messages: readonly ChatMessage[], now = Date.now()) {
  let remaining = 2400
  return messages
    .filter(
      (m) =>
        !m.divider &&
        !m.toolCalls?.length &&
        !m.error &&
        !['local_pending', 'sending', 'unconfirmed', 'failed'].includes(m.deliveryState ?? '') &&
        m.ts >= now - 1800000 &&
        m.ts <= now,
    )
    .slice(-6)
    .reverse()
    .reduce<Array<{ role: ChatMessage['role']; text: string; ts: number }>>((result, m) => {
      if (remaining <= 0) return result
      const text = m.content.slice(0, Math.min(600, remaining))
      remaining -= text.length
      if (text.trim()) result.push({ role: m.role, text, ts: m.ts })
      return result
    }, [])
    .reverse()
}
export async function readListeningContext(accountId: string, machineId: string) {
  const [{ useStewardSessionsStore }, { personalSessionBodyStore }, { envelopeToChatMessage }] =
    await Promise.all([
      import('../steward/stewardSessionsStore'),
      import('../../storage/db'),
      import('@shennian/shared'),
    ])
  const state = useStewardSessionsStore.getState()
  if (state.accountId !== accountId) return null
  const session = [...state.sessions]
    .filter(
      (s) =>
        s.userId === accountId &&
        s.machineId === machineId &&
        s.sessionScope === 'steward' &&
        !s.deletedAt &&
        s.localCreationState !== 'draft',
    )
    .sort(
      (a, b) =>
        Date.parse(b.lastActivityAt ?? b.createdAt) - Date.parse(a.lastActivityAt ?? a.createdAt),
    )[0]
  if (!session) return null
  // Cached replica only: never pull a computer's full history for an ambient recording.
  const envelopes = await personalSessionBodyStore.getMessages(accountId, session.id, { limit: 12 })
  const messages = boundedListeningContext(
    envelopes.map((e) => envelopeToChatMessage(e, e.deliveryState)),
  )
  return messages.length ? { sessionId: session.id, messages } : null
}
