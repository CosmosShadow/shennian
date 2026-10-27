// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/native-fusion-parsers.test.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readJsonlLines, safeParse } from './parser-common.js'

const GENERIC_CODEX_THREAD_NAMES = new Set([
  'untitled',
  'new chat',
  'new conversation',
  'new task',
  'new thread',
  'codex',
  '无标题',
  '未命名',
  '新任务',
  '新会话',
  '新对话',
])

function readCodexIndexTitle(
  parsed: Record<string, unknown>,
  sourceSessionKey: string,
): string | null {
  const id =
    typeof parsed.id === 'string'
      ? parsed.id
      : typeof parsed.thread_id === 'string'
        ? parsed.thread_id
        : typeof parsed.session_id === 'string'
          ? parsed.session_id
          : ''
  if (id !== sourceSessionKey) return null
  const title =
    typeof parsed.thread_name === 'string'
      ? parsed.thread_name
      : typeof parsed.title === 'string'
        ? parsed.title
        : ''
  const trimmed = title.trim()
  return trimmed && !isGenericCodexThreadName(trimmed) ? trimmed.slice(0, 120) : null
}

function isGenericCodexThreadName(value: string): boolean {
  const normalized = value.trim().toLocaleLowerCase().replace(/[\s_-]+/g, ' ')
  return GENERIC_CODEX_THREAD_NAMES.has(normalized)
}

export function lookupCodexThreadName(sourceSessionKey: string): string | null {
  if (!sourceSessionKey) return null
  const indexPath = path.join(os.homedir(), '.codex', 'session_index.jsonl')
  if (!fs.existsSync(indexPath)) return null

  let latestTitle: string | null = null
  readJsonlLines(indexPath, 0, (line) => {
    if (!line.trim()) return
    const parsed = safeParse(line)
    if (!parsed) return
    const title = readCodexIndexTitle(parsed, sourceSessionKey)
    if (title) latestTitle = title
  })

  return latestTitle
}

export function listCodexRolloutFiles(): string[] {
  const roots = [
    path.join(os.homedir(), '.codex', 'sessions'),
    path.join(os.homedir(), '.codex', 'archived_sessions'),
  ]
  const files: string[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(full)
    }
  }
  for (const root of roots) {
    if (fs.existsSync(root)) walk(root)
  }
  return [...new Set(files)].sort()
}

export function isCodexRolloutTailInterrupted(content: string): boolean {
  const lines = content.split('\n')
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const parsed = safeParse(lines[index] ?? '')
    if (parsed?.type !== 'event_msg') continue
    const payload = typeof parsed.payload === 'object' && parsed.payload !== null
      ? parsed.payload as Record<string, unknown>
      : null
    const eventType = typeof payload?.type === 'string' ? payload.type : ''
    if (eventType === 'turn_aborted') return true
    if (
      eventType === 'task_started' ||
      eventType === 'turn_started' ||
      eventType === 'task_complete' ||
      eventType === 'turn_complete' ||
      eventType === 'turn_completed'
    ) return false
  }
  return false
}

/**
 * Codex keeps an interrupted externally-owned thread loaded, but pauses its
 * persistent queue. Inspect only the rollout tail: lifecycle events are
 * appended after the turn output, so a later resume naturally supersedes an
 * earlier abort.
 */
export function isCodexThreadTailInterrupted(sourceSessionKey: string): boolean {
  if (!sourceSessionKey) return false
  const candidates = listCodexRolloutFiles()
    .filter((filePath) => path.basename(filePath).includes(sourceSessionKey))
    .map((filePath) => ({ filePath, mtimeMs: fs.statSync(filePath).mtimeMs }))
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
  const filePath = candidates[0]?.filePath
  if (!filePath) return false

  const fd = fs.openSync(filePath, 'r')
  try {
    const size = fs.fstatSync(fd).size
    const tailBytes = Math.min(size, 512 * 1024)
    const buffer = Buffer.allocUnsafe(tailBytes)
    fs.readSync(fd, buffer, 0, tailBytes, size - tailBytes)
    return isCodexRolloutTailInterrupted(buffer.toString('utf8'))
  } finally {
    fs.closeSync(fd)
  }
}
