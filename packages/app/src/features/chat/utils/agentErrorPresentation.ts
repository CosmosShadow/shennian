// @arch docs/architecture/app/modular-features.md#聊天-feature
// @test src/__tests__/chat-webview-markdown.test.ts

type Translate = (key: string, options?: Record<string, unknown>) => string

export function presentAgentUpstreamError(content: string, translate: Translate): string {
  const match = /^(\d{3}):\s*(\{[\s\S]*\})$/.exec(content.trim())
  if (!match || content.length > 2_000) return content
  try {
    const payload = JSON.parse(match[2]!) as {
      message?: unknown
      type?: unknown
      error?: { message?: unknown; type?: unknown }
    }
    const error = payload.error ?? payload
    if (error.type !== 'upstream_error' || typeof error.message !== 'string') return content
    return translate('agent_upstream_unavailable', { status: match[1] })
  } catch {
    return content
  }
}
