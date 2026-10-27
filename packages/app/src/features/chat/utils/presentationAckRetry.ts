// @arch docs/features/unread-notification-center.md#54-已读提交条件
// @test src/__tests__/presentation-ack-retry.test.ts

type Timer = ReturnType<typeof setTimeout>

/**
 * Presentation acknowledgement crosses the React Native -> WebView -> React
 * Native bridge. Keep sending the idempotent token until the owner clears it
 * after the read watermark has been committed.
 */
export function startPresentationAckRetry(
  presentationToken: string,
  acknowledge: (presentationToken: string) => void,
  initialDelayMs = 500,
  maxDelayMs = 5_000,
): () => void {
  let timer: Timer | null = null
  let stopped = false
  let nextDelay = Math.max(100, initialDelayMs)
  const maximumDelay = Math.max(nextDelay, maxDelayMs)

  const send = () => {
    if (stopped) return
    acknowledge(presentationToken)
    timer = setTimeout(send, nextDelay)
    nextDelay = Math.min(maximumDelay, nextDelay * 2)
  }

  send()

  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
    timer = null
  }
}
