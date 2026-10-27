// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/native-fusion-parsers.test.ts

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const MAX_JSONL_LINE_BYTES = 64 * 1024 * 1024
const JSONL_READ_CHUNK_BYTES = 256 * 1024
const DEFAULT_NATIVE_SCAN_IGNORED_PATHS = [
  '/root/.claude-mem/observer-session',
  path.join(os.tmpdir(), 'shennian-agent-e2e'),
]
const DEFAULT_NATIVE_SCAN_IGNORED_CLAUDE_PROJECT_DIRS = DEFAULT_NATIVE_SCAN_IGNORED_PATHS.map(encodeClaudeProjectDir)

export function normalizeText(text: string): string {
  return stripGitDirectiveArtifacts(text.replace(/\r\n/g, '\n').trim())
}

const GIT_DIRECTIVE_LINE_RE = /^\s*::git-[a-z-]+\{[^\n]*\}\s*$/gm

function stripGitDirectiveArtifacts(text: string): string {
  if (!text) return ''
  const hadDirective = /(^|\n)\s*::git-[a-z-]+\{[^\n]*\}\s*(?=\n|$)/.test(text)
  if (!hadDirective) return text
  const stripped = text.replace(GIT_DIRECTIVE_LINE_RE, '')
  if (!stripped.trim()) return ''
  return stripped.replace(/[ \t]+\n/g, '\n').replace(/\n+$/g, '')
}

export function readTimestamp(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const ts = Date.parse(value)
  return Number.isFinite(ts) ? ts : null
}

export function safeParse(line: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(line) as unknown
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export function readJsonlLines(
  filePath: string,
  startOffset: number,
  onLine: (line: string, lineOffset: number) => void,
): number {
  const stat = fs.statSync(filePath)
  const fileSize = stat.size
  if (startOffset >= fileSize) return fileSize

  const fd = fs.openSync(filePath, 'r')
  try {
    const buffer = Buffer.allocUnsafe(JSONL_READ_CHUNK_BYTES)
    let position = startOffset
    let nextOffset = startOffset
    let carry = Buffer.alloc(0)
    let skippingOversizedLine = false

    while (position < fileSize) {
      const bytesRead = fs.readSync(
        fd,
        buffer,
        0,
        Math.min(JSONL_READ_CHUNK_BYTES, fileSize - position),
        position,
      )
      if (bytesRead <= 0) break
      position += bytesRead
      let chunk = buffer.subarray(0, bytesRead)
      if (carry.length > 0) {
        chunk = Buffer.concat([carry, chunk])
        carry = Buffer.alloc(0)
      }

      let lineStart = 0
      while (lineStart < chunk.length) {
        const newlineIndex = chunk.indexOf(0x0a, lineStart)
        if (newlineIndex < 0) break
        const lineBuffer = chunk.subarray(lineStart, newlineIndex)
        const lineOffset = nextOffset
        nextOffset += newlineIndex - lineStart + 1
        lineStart = newlineIndex + 1
        if (!skippingOversizedLine && lineBuffer.length > 0 && lineBuffer.length <= MAX_JSONL_LINE_BYTES) {
          onLine(lineBuffer.toString('utf8'), lineOffset)
        }
        skippingOversizedLine = false
      }

      if (lineStart < chunk.length) {
        const remaining = chunk.subarray(lineStart)
        if (skippingOversizedLine || remaining.length > MAX_JSONL_LINE_BYTES) {
          skippingOversizedLine = true
          nextOffset += remaining.length
          carry = Buffer.alloc(0)
        } else {
          carry = Buffer.from(remaining)
        }
      }
    }

    // An unterminated JSONL tail may still be in the middle of a write. Keep
    // the cursor at the last newline so the next reconciliation re-reads it.
    return nextOffset
  } finally {
    fs.closeSync(fd)
  }
}

/**
 * Drain the complete JSONL snapshot that exists when the read starts while
 * yielding between disk chunks. The chunk size bounds one synchronous slice;
 * it is deliberately not a transcript or reconciliation limit.
 */
export async function readJsonlLinesCooperatively(
  filePath: string,
  startOffset: number,
  onLine: (line: string, lineOffset: number) => void,
): Promise<number> {
  const stat = await fs.promises.stat(filePath)
  const snapshotEndOffset = stat.size
  if (startOffset >= snapshotEndOffset) return snapshotEndOffset

  const handle = await fs.promises.open(filePath, 'r')
  try {
    const buffer = Buffer.allocUnsafe(JSONL_READ_CHUNK_BYTES)
    let position = startOffset
    let nextOffset = startOffset
    let carry = Buffer.alloc(0)
    let skippingOversizedLine = false

    while (position < snapshotEndOffset) {
      const { bytesRead } = await handle.read(
        buffer,
        0,
        Math.min(JSONL_READ_CHUNK_BYTES, snapshotEndOffset - position),
        position,
      )
      if (bytesRead <= 0) break
      position += bytesRead
      let chunk = buffer.subarray(0, bytesRead)
      if (carry.length > 0) {
        chunk = Buffer.concat([carry, chunk])
        carry = Buffer.alloc(0)
      }

      let lineStart = 0
      while (lineStart < chunk.length) {
        const newlineIndex = chunk.indexOf(0x0a, lineStart)
        if (newlineIndex < 0) break
        const lineBuffer = chunk.subarray(lineStart, newlineIndex)
        const lineOffset = nextOffset
        nextOffset += newlineIndex - lineStart + 1
        lineStart = newlineIndex + 1
        if (!skippingOversizedLine && lineBuffer.length > 0 && lineBuffer.length <= MAX_JSONL_LINE_BYTES) {
          onLine(lineBuffer.toString('utf8'), lineOffset)
        }
        skippingOversizedLine = false
      }

      if (lineStart < chunk.length) {
        const remaining = chunk.subarray(lineStart)
        if (skippingOversizedLine || remaining.length > MAX_JSONL_LINE_BYTES) {
          skippingOversizedLine = true
          nextOffset += remaining.length
          carry = Buffer.alloc(0)
        } else {
          carry = Buffer.from(remaining)
        }
      }

      if (position < snapshotEndOffset) await new Promise<void>((resolve) => setImmediate(resolve))
    }

    return nextOffset
  } finally {
    await handle.close()
  }
}

export function findJsonlLookbackOffset(
  filePath: string,
  startOffset: number,
  lineCount = 64,
): number {
  if (startOffset <= 0 || lineCount <= 0) return 0
  const fd = fs.openSync(filePath, 'r')
  try {
    let position = startOffset
    let remaining = lineCount
    while (position > 0) {
      const length = Math.min(position, 64 * 1024)
      position -= length
      const buffer = Buffer.allocUnsafe(length)
      fs.readSync(fd, buffer, 0, length, position)
      for (let index = length - 1; index >= 0; index -= 1) {
        if (buffer[index] !== 0x0a || position + index + 1 === startOffset) continue
        remaining -= 1
        if (remaining === 0) return position + index + 1
      }
    }
    return 0
  } finally {
    fs.closeSync(fd)
  }
}

export function readClaudeEventCwd(parsed: Record<string, unknown>): string | null {
  return typeof parsed.cwd === 'string' && parsed.cwd.trim() ? parsed.cwd : null
}

export function isClaudeSubagentTranscript(filePath: string): boolean {
  return path.basename(path.dirname(filePath)) === 'subagents'
}

export function normalizePathForCompare(filePath: string): string {
  const normalized = path.resolve(filePath)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

export function isSameOrChildPath(filePath: string, parentPath: string): boolean {
  const normalizedFilePath = normalizePathForCompare(filePath)
  const normalizedParentPath = normalizePathForCompare(parentPath)
  return normalizedFilePath === normalizedParentPath
    || normalizedFilePath.startsWith(normalizedParentPath + path.sep)
}

export function encodeClaudeProjectDir(filePath: string): string {
  return path.resolve(filePath).replace(/\//g, '-')
}

export function shouldIgnoreNativeScanPath(filePath: string): boolean {
  return DEFAULT_NATIVE_SCAN_IGNORED_PATHS.some((ignoredPath) => isSameOrChildPath(filePath, ignoredPath))
}

export function shouldIgnoreClaudeProjectDir(projectDirName: string): boolean {
  return DEFAULT_NATIVE_SCAN_IGNORED_CLAUDE_PROJECT_DIRS.includes(projectDirName)
}

export function shouldIgnoreClaudeTranscriptPath(filePath: string): boolean {
  const root = path.join(os.homedir(), '.claude', 'projects')
  const relative = path.relative(root, filePath)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return false
  const [projectDirName] = relative.split(path.sep)
  return projectDirName ? shouldIgnoreClaudeProjectDir(projectDirName) : false
}

export function makeCursor(filePath: string, offset: number): string {
  return `${filePath}:${offset}`
}

export function makeEventKey(filePath: string, offset: number, kind: string): string {
  const fingerprint = createHash('sha1').update(filePath).digest('hex').slice(0, 16)
  return `${fingerprint}:${offset}:${kind}`
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

export function normalizeToolText(text: string): string {
  return text.replace(/\r\n/g, '\n').trim()
}

export function parseStructuredString(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (!trimmed) return ''
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    return value
  }
}

export function buildToolPayload(input: {
  name: string
  toolCallId: string
  detailRevision: number
  status: 'running' | 'completed' | 'failed'
  durationMs?: number
}): string {
  const payload: Record<string, unknown> = {
    v: 1,
    type: 'tool',
    name: input.name,
    toolCallId: input.toolCallId,
    detailRevision: input.detailRevision,
    status: input.status,
    resultOmitted: true,
    detailAvailable: true,
    ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
  }
  return JSON.stringify(payload)
}

export function escapeMarkdownLabel(label: string): string {
  return label.replace(/[[\]\\]/g, '\\$&')
}

export function buildMarkdownImageRef(filePath: string, label = 'Generated image'): string {
  return `![${escapeMarkdownLabel(label)}](<${filePath}>)`
}

export function buildImagePayload(filePath: string): string {
  const name = path.basename(filePath) || 'generated-image.png'
  return JSON.stringify({
    v: 1,
    type: 'image',
    content: buildMarkdownImageRef(filePath, name),
    attachments: [
      {
        path: filePath,
        name,
        mimeType: 'image/png',
        kind: 'image',
      },
    ],
  })
}

export function inferMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.png') return 'image/png'
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  return 'application/octet-stream'
}
