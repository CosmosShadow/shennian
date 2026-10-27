// @arch docs/features/agent-workspaces.md
// @test src/__tests__/start-agent-conversation.test.ts
import type { NianSession } from '@shennian/wire'

/** One creation intent per click flow; failed requests/persistence can safely retry. */
export function createAgentConversationStarter(deps: {
  newIntent(): string
  create(intentId: string): Promise<NianSession>
  persist(session: NianSession): Promise<void>
  open(sessionId: string): void
  isCurrent(): boolean
  setBusy(busy: boolean): void
}) {
  let busy = false
  let intentId: string | null = null
  let session: NianSession | null = null
  return async () => {
    if (busy || !deps.isCurrent()) return
    busy = true
    deps.setBusy(true)
    try {
      intentId ??= deps.newIntent()
      session ??= await deps.create(intentId)
      if (!deps.isCurrent()) return
      await deps.persist(session)
      if (!deps.isCurrent()) return
      deps.open(session.id)
      intentId = null
      session = null
    } finally {
      busy = false
      if (deps.isCurrent()) deps.setBusy(false)
    }
  }
}
