// @arch docs/features/network-rooms/ui.md#入群审批提醒
// @test src/__tests__/room-approval-counts.test.ts

/** Account-scoped request counts; reading a chat never acknowledges an approval. */
export function createRoomApprovalCounts() {
  const counts = new Map<string, number>()
  const revisions = new Map<string, number>()
  const listeners = new Set<() => void>()
  const key = (accountId: string, roomId: string) => JSON.stringify([accountId, roomId])
  const publish = () => listeners.forEach((listener) => listener())
  return {
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    get(accountId: string, roomId: string) {
      return counts.get(key(accountId, roomId)) ?? 0
    },
    set(accountId: string, roomId: string, count: number) {
      const id = key(accountId, roomId)
      revisions.set(id, (revisions.get(id) ?? 0) + 1)
      counts.set(id, count)
      publish()
    },
    async refresh(accountId: string, roomId: string, load: () => Promise<unknown[]>) {
      const id = key(accountId, roomId)
      const revision = (revisions.get(id) ?? 0) + 1
      revisions.set(id, revision)
      try {
        const requests = await load()
        if (revisions.get(id) !== revision) return
        counts.set(id, requests.length)
        publish()
      } catch {
        // Offline/temporary failures must not acknowledge pending applications.
      }
    },
  }
}

export const roomApprovalCounts = createRoomApprovalCounts()
