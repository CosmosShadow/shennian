// @arch open-source/docs/shared-runtime.md
// @test src/__tests__/sync-engine-offline.test.ts

import type { Envelope } from '@shennian/wire'

const TOOL_WITH_RESULT_RE = /^\{"v":\d+,"type":"(?:tool|tool_result)".*"result":/

export function mergePreferLocalResult(local: Envelope[], server: Envelope[]): Envelope[] {
  const localById = new Map<string, Envelope>()
  for (const message of local) localById.set(message.id, message)

  return server.map((serverMessage) => {
    const localMessage = localById.get(serverMessage.id)
    if (!localMessage) return serverMessage
    if (
      TOOL_WITH_RESULT_RE.test(localMessage.payload) &&
      !TOOL_WITH_RESULT_RE.test(serverMessage.payload)
    ) {
      return localMessage
    }
    return serverMessage
  })
}
