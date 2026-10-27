// @arch docs/features/published-agent-direct-conversations.md
// @test src/__tests__/published-agent-failure-copy-key.test.ts

/**
 * Maps a wire `failureCode` to the shared camelCase copy key both the Web
 * landing page and the App's "published conversations" detail screen use
 * for their own independently maintained `copy.zh`/`copy.en` objects. Kept
 * in one place because the two surfaces previously duplicated this mapping
 * and both silently missed a new code (`unauthorized_tool_attempt`) — a
 * defined copy string that was never wired into either switch.
 */
export type PublishedAgentFailureCopyKey =
  | 'timeout'
  | 'emptyReply'
  | 'runtimeUnavailable'
  | 'providerLimit'
  | 'retryExhausted'
  | 'unauthorizedToolAttempt'

export function publishedAgentFailureCopyKey(
  code: string | null | undefined,
): PublishedAgentFailureCopyKey | null {
  switch (code) {
    case 'timeout': return 'timeout'
    case 'empty_reply': return 'emptyReply'
    case 'runtime_unavailable': return 'runtimeUnavailable'
    case 'provider_limit': return 'providerLimit'
    case 'retry_exhausted': return 'retryExhausted'
    case 'unauthorized_tool_attempt': return 'unauthorizedToolAttempt'
    default: return null
  }
}
