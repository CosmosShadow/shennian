// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/manager-inbox.test.ts

export type WorkerMarkdownKind =
  | 'created'
  | 'progress'
  | 'message'
  | 'completed'
  | 'failed'
  | 'stopped'

const LABELS: Record<WorkerMarkdownKind, string> = {
  created: '创建 Agent',
  progress: 'Agent 执行中',
  message: '发送消息',
  completed: 'Agent 完成',
  failed: 'Agent 失败',
  stopped: '停止 Agent',
}

export function deriveWorkerTitle(message: string): string {
  const firstReadableLine = message
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/^\s{0,3}(?:#{1,6}|[-*+]\s|\d+[.)]\s)\s*/, '').trim())
    .find(Boolean) ?? '新 Agent 任务'
  return normalizeWorkerTitle(firstReadableLine)
}

export function normalizeWorkerTitle(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim() || '新 Agent 任务'
  return compact.length > 48 ? `${compact.slice(0, 47)}…` : compact
}

export function workerSessionUrl(sessionId: string): string {
  return `shennian://session/${encodeURIComponent(sessionId)}`
}

export function formatWorkerMarkdown(input: {
  kind: WorkerMarkdownKind
  sessionId: string
  title: string
  body: string
}): string {
  const title = normalizeWorkerTitle(input.title)
    .replace(/\\/g, '\\\\')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
  const body = input.body.replace(/\r\n/g, '\n').trim()
  const heading = `[${LABELS[input.kind]} · ${title}](${workerSessionUrl(input.sessionId)})`
  return body ? `${heading}\n\n${body}` : heading
}
