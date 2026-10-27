// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/wait-for-messages.test.ts

export type MessagePage = { messages?: unknown }

export async function waitForMessages<T extends MessagePage>(
  read: (after: string) => Promise<T>,
  after: string,
  timeoutSeconds: number,
): Promise<{ messages: unknown[]; timedOut: boolean; after: string }> {
  const deadline = Date.now() + timeoutSeconds * 1000
  while (true) {
    const page = await read(after)
    if (!Array.isArray(page.messages)) throw new Error('invalid_message_page')
    if (page.messages.length > 0) return { messages: page.messages, timedOut: false, after }
    const remaining = deadline - Date.now()
    if (remaining <= 0) return { messages: [], timedOut: true, after }
    await new Promise(resolve => setTimeout(resolve, Math.min(2000, remaining)))
  }
}

export function parseWaitTimeout(raw: string): number {
  const seconds = Number(raw)
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 60) {
    throw new Error('invalid_wait_timeout')
  }
  return seconds
}
