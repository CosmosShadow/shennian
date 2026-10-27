// @arch docs/features/published-agent-direct-conversations.md
import { useCallback, useRef, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import { useAuthStore } from '../../config/auth'
import { ApiError } from '@shennian/shared/api'
import { listMyPublishedConversations, listOwnedPublishedConversations, type MyPublishedConversation } from './directConversationClient'

/** Independent bounded legacy-compatible feeds. Owner inventory never changes Room membership. */
export function usePublishedConversationList(showOwned: boolean) {
  const accountId = useAuthStore((state) => state.user?.id)
  const [state, setState] = useState<{ accountId?: string; rows: MyPublishedConversation[];
    visitorCursor: string | null; ownerCursor: string | null; failed: boolean }>({
    rows: [], visitorCursor: null, ownerCursor: null, failed: false,
  })
  const [loading, setLoading] = useState(false)
  const generation = useRef(0)
  const stateRef = useRef(state)
  stateRef.current = state
  const busy = useRef(false)
  const paged = useRef(false)
  const load = useCallback(async (more = false) => {
    if (!accountId || busy.current) return
    const request = generation.current
    busy.current = true
    setLoading(true)
    const previous = stateRef.current.accountId === accountId ? stateRef.current : null
    try {
      const [visitorResult, ownerResult] = await Promise.allSettled([
        !more || previous?.visitorCursor ? listMyPublishedConversations(more ? previous?.visitorCursor ?? undefined : undefined) : null,
        showOwned && (!more || previous?.ownerCursor)
          ? listOwnedPublishedConversations(more ? previous?.ownerCursor ?? undefined : undefined) : null,
      ])
      if (request !== generation.current) return
      const visitor = visitorResult.status === 'fulfilled' ? visitorResult.value : null
      const owner = ownerResult.status === 'fulfilled' ? ownerResult.value : null
      const ownerUnsupported = ownerResult.status === 'rejected' && ownerResult.reason instanceof ApiError
        && ownerResult.reason.status === 404
      const retained = more ? previous?.rows ?? [] : (previous?.rows ?? []).filter((row) =>
        row.role === 'owner' ? ownerResult.status === 'rejected' && !ownerUnsupported : visitorResult.status === 'rejected')
      const byId = new Map(retained.map((row) => [row.id, row]))
      for (const row of visitor?.conversations ?? []) byId.set(row.id, { ...row, role: row.role ?? 'visitor' })
      // Explicit owner perspective also handles a publisher who tried their own link.
      for (const row of owner?.conversations ?? []) byId.set(row.id, { ...row, role: 'owner' })
      setState({ accountId, rows: [...byId.values()],
        failed: visitorResult.status === 'rejected' || (ownerResult.status === 'rejected' && !ownerUnsupported),
        visitorCursor: visitor ? visitor.nextCursor : previous?.visitorCursor ?? null,
        ownerCursor: owner ? owner.nextCursor : showOwned ? previous?.ownerCursor ?? null : null,
      })
      if (more) paged.current = true
    } catch {
      if (request === generation.current) setState((current) => ({ ...current, failed: true }))
    } finally {
      if (request === generation.current) { busy.current = false; setLoading(false) }
    }
  }, [accountId, showOwned])
  useFocusEffect(useCallback(() => {
    generation.current += 1
    busy.current = false
    paged.current = false
    void load()
    // Publishers are not Room members, so their legacy visitor inventory does
    // not receive ordinary Room events. Keep the first page fresh while focused.
    // Do not collapse older pages while someone is browsing the loaded history.
    const timer = setInterval(() => { if (!paged.current) void load() }, 15_000)
    return () => { generation.current += 1; busy.current = false; clearInterval(timer) }
  }, [load]))
  return { rows: state.accountId === accountId ? state.rows.filter((row) => showOwned || row.role !== 'owner') : [],
    hiddenOwnedIds: state.accountId === accountId && !showOwned ? state.rows.filter((row) => row.role === 'owner').map((row) => row.id) : [],
    hasMore: state.accountId === accountId && Boolean(state.visitorCursor || (showOwned && state.ownerCursor)),
    failed: state.accountId === accountId && state.failed, loading, retry: () => load(), loadMore: () => load(true) }
}
