// @arch docs/features/desktop-local-first-client.md#54-同步与服务器压力
// @test src/__tests__/chat-background-history-loading.test.ts
import type { PersonalSessionBodyStore } from '../../storage/personal-session-body-store.native'

// A single Agent turn may contain thousands of tool messages. Bound the actual
// records crossing IPC, not just the number of user turns. Increasing the window
// still reaches all older records, including those inside a long single turn.
export async function readDesktopChatHistory(
  store: Pick<PersonalSessionBodyStore, 'getMessages'>,
  accountId: string,
  sessionId: string,
  turnLimit: number,
) {
  let remaining = Math.max(1, Math.floor(turnLimit)) * 10
  let beforeSequence: number | undefined
  const pages: Awaited<ReturnType<PersonalSessionBodyStore['getMessages']>>[] = []
  while (remaining > 0) {
    const limit = Math.min(remaining, 1000)
    const page = await store.getMessages(accountId, sessionId, { limit, beforeSequence })
    pages.push(page)
    remaining -= page.length
    const first = page[0]?.localSequence
    if (page.length < limit || first === undefined) break
    if (beforeSequence !== undefined && first >= beforeSequence) break
    beforeSequence = first
  }
  return pages.reduceRight((messages, page) => messages.concat(page), [] as typeof pages[number])
}
