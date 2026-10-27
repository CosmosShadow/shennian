// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/codex-adapter.test.ts

export function makeThreadTitle(text: string): string {
  const firstLine = normalizeTitleText(text).split('\n').find((line) => line.trim()) ?? 'Shennian'
  const title = firstLine.trim().slice(0, 80)
  return title || 'Shennian'
}

export const CODEX_APP_SERVER_CLIENT_INFO = {
  name: 'codex-tui',
  title: 'Codex TUI',
  version: '0.0.0',
} as const

const CODEX_COLLAB_AGENT_TOOL_NAMES = new Set([
  'spawnAgent',
  'sendInput',
  'resumeAgent',
  'wait',
  'closeAgent',
  'waitAgent',
])

export function isCodexCollabAgentToolName(name: string): boolean {
  return CODEX_COLLAB_AGENT_TOOL_NAMES.has(name)
}

export function isCodexCollabAgentItem(item: Record<string, unknown>): boolean {
  if (item.type === 'collabAgentToolCall') return true
  if (item.type === 'collabAgentMonitor') return true
  const tool = typeof item.tool === 'string' ? item.tool : ''
  if (tool && isCodexCollabAgentToolName(tool)) return true
  return typeof item.senderThreadId === 'string' && Array.isArray(item.receiverThreadIds)
}

export function isCodexLegacyCollabAgentItem(item: { type?: string; tool?: string }): boolean {
  if (item.type === 'collab_agent_tool_call' || item.type === 'collabAgentToolCall') return true
  if (item.type === 'collab_agent_monitor' || item.type === 'collabAgentMonitor') return true
  return !!item.tool && isCodexCollabAgentToolName(item.tool)
}

export function normalizeTitleText(text: string): string {
  return text
    .replace(/!\[[^\]]*]\([^)]+\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizeCodexModelId(modelId?: string | null): string | undefined {
  const trimmed = modelId?.trim()
  if (!trimmed) return undefined
  return trimmed.toLowerCase() === 'openai' ? undefined : trimmed
}

export function normalizeCodexReasoningEffort(reasoningEffort?: string | null): string | undefined {
  const trimmed = reasoningEffort?.trim()
  return trimmed || undefined
}

export function isMissingCodexRolloutError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return /\bno rollout found for thread id\b/i.test(message)
}

export function isCodexUnsupportedEffortError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return (
    /\bunknown field\b.*\beffort\b/i.test(message) ||
    /\binvalid.*\beffort\b/i.test(message) ||
    /\bunsupported.*\beffort\b/i.test(message) ||
    /\breasoning effort\b/i.test(message)
  )
}

export function extractAppServerErrorMessage(params: Record<string, unknown>): string {
  if (typeof params.message === 'string' && params.message.trim()) return params.message.trim()
  const error = params.error
  if (typeof error === 'string' && error.trim()) return error.trim()
  if (typeof error === 'object' && error !== null) {
    const message = (error as Record<string, unknown>).message
    if (typeof message === 'string' && message.trim()) return message.trim()
  }
  return 'codex app-server error'
}

export function isTransientCodexErrorMessage(message: string): boolean {
  return /\bReconnecting\.\.\.\s*\d+\/\d+/i.test(message)
}

export function formatTransientCodexStatus(message: string): string {
  const match = message.match(/\bReconnecting\.\.\.\s*(\d+\/\d+)/i)
  if (!match) return ''
  return `Codex API 暂时不可用，正在重试 ${match[1]}...`
}

export function formatCodexErrorMessage(message: string): string {
  const statusMatch = message.match(
    /unexpected status\s+(\d+)\s+([^:,]+)(?::\s*([^,]+))?(?:,\s*url:\s*([^,\s]+))?(?:,\s*request id:\s*([^\s,]+))?/i,
  )
  if (!statusMatch) return message

  const [, status, statusText, detail, url, requestId] = statusMatch
  const parts = [
    `Codex API 返回 ${status} ${statusText.trim()}`,
    detail?.trim() ? `：${detail.trim()}` : '',
    url ? `\n上游地址：${url}` : '',
    requestId ? `\nrequest id：${requestId}` : '',
  ]
  return parts.join('')
}

const GIT_DIRECTIVE_LINE_RE = /^\s*::git-[a-z-]+\{[^\n]*\}\s*$/gm

export function stripGitDirectiveArtifacts(text: string): string {
  if (!text) return ''
  const normalized = text.replace(/\r\n/g, '\n')
  const hadDirective = /(^|\n)\s*::git-[a-z-]+\{[^\n]*\}\s*(?=\n|$)/.test(normalized)
  if (!hadDirective) return normalized
  const stripped = normalized.replace(GIT_DIRECTIVE_LINE_RE, '')
  if (!stripped.trim()) return ''
  return stripped.replace(/[ \t]+\n/g, '\n').replace(/\n+$/g, '')
}

export function safeStringify(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function normalizeCodexStderr(stderr: string): string {
  const normalized = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !isIgnorableCodexStderrLine(line))
    .join('\n')
  if (looksLikeMissingNodeOnWindows(normalized)) {
    return 'Codex 启动失败：系统找不到 node。请重新安装 Node.js，或把 Node.js 安装目录（通常是 C:\\Program Files\\nodejs）加入 Windows PATH 后重启神念。'
  }
  return normalized
}

export function looksLikeMissingNodeOnWindows(text: string): boolean {
  if (!text) return false
  return (
    /["']?node["']?/i.test(text) &&
    (
      /not recognized as an internal or external command/i.test(text) ||
      text.includes('不是内部或外部命令') ||
      text.includes('不是可运行的程序') ||
      text.includes('��������') ||
      text.includes('����')
    )
  )
}

export function normalizeTerminalText(text: string): string {
  const escape = String.fromCharCode(27)
  const bell = String.fromCharCode(7)
  const csiPattern = new RegExp(`${escape}\\[[0-?]*[ -/]*[@-~]`, 'g')
  const oscPattern = new RegExp(`${escape}\\][^${bell}]*(?:${bell}|${escape}\\\\)`, 'g')

  return text
    .replace(csiPattern, ' ')
    .replace(oscPattern, ' ')
    .split('')
    .map((char) => {
      const code = char.charCodeAt(0)
      return (code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127) ? ' ' : char
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}

export function looksLikeCodexInteractiveAuthPrompt(text: string): boolean {
  if (!text) return false
  const normalized = text.toLowerCase()
  return (
    normalized.includes('welcome to codex') ||
    normalized.includes('sign in with chatgpt') ||
    normalized.includes('provide your own api key') ||
    normalized.includes('press enter to continue')
  )
}

export function isIgnorableCodexStderrLine(line: string): boolean {
  return [
    /WARNING: proceeding, even though we could not update PATH:/i,
    /Reading additional input from stdin\.\.\./i,
    /failed to record rollout items: failed to queue rollout items: channel closed/i,
  ].some((pattern) => pattern.test(line))
}

export function looksLikeFatalCodexStderr(stderr: string): boolean {
  if (!stderr) return false
  return [
    /\bunauthorized\b/i,
    /\bforbidden\b/i,
    /\bpermission denied\b/i,
    /\brate limit\b/i,
    /\binsufficient quota\b/i,
    /\bapi key\b/i,
    /\bauth/i,
    /\bnetwork\b/i,
    /\btimeout\b/i,
    /\bnot found\b/i,
    /\berror\b/i,
    /\bfailed\b/i,
  ].some((pattern) => pattern.test(stderr))
}
