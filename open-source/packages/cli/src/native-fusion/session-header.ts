// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/native-fusion-parsers.test.ts

import fs from 'node:fs'
import { readTimestamp, safeParse } from './parser-common.js'

const MAX_HEADER_BYTES = 1024 * 1024
const MAX_HEADER_RECORDS = 64

export type NativeSessionFileInspection =
  | { status: 'pending' }
  | {
      status: 'ready'
      createdAtMs: number
      sourceCreatedAtByKey?: Record<string, number>
      sources: Array<{ agentType: 'codex' | 'claude' | 'opencode'; sourceSessionKey: string }>
    }

export function inspectNativeSessionFile(filePath: string): NativeSessionFileInspection {
  if (filePath.endsWith('.opencode-session.json')) return inspectOpenCodeSnapshot(filePath)
  const records = readHeaderRecords(filePath)
  if (records.length === 0) return { status: 'pending' }
  const stat = fs.statSync(filePath)

  if (filePath.split(/[\\/]+/).includes('.codex')) {
    const meta = records.find((record) => record.type === 'session_meta')
    if (!meta) return { status: 'pending' }
    const payload = objectRecord(meta.payload)
    const createdAtMs = readTimestamp(meta.timestamp)
      ?? readTimestamp(payload?.timestamp)
      ?? validBirthtime(stat.birthtimeMs)
    const sourceSessionKey = typeof payload?.id === 'string' ? payload.id : ''
    return createdAtMs && sourceSessionKey
      ? { status: 'ready', createdAtMs, sources: [{ agentType: 'codex', sourceSessionKey }] }
      : { status: 'pending' }
  }

  const firstTimestamp = records.map((record) => readTimestamp(record.timestamp)).find((value) => value != null)
  const createdAtMs = firstTimestamp ?? validBirthtime(stat.birthtimeMs)
  const sourceSessionKey = pathBasenameWithoutJsonl(filePath)
  return createdAtMs && sourceSessionKey
    ? { status: 'ready', createdAtMs, sources: [{ agentType: 'claude', sourceSessionKey }] }
    : { status: 'pending' }
}

function inspectOpenCodeSnapshot(filePath: string): NativeSessionFileInspection {
  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown
  } catch {
    return { status: 'pending' }
  }
  const root = objectRecord(parsed)
  if (!root || !Array.isArray(root.sessions) || root.sessions.length === 0) return { status: 'pending' }
  const sourceCreatedAtByKey: Record<string, number> = {}
  for (const value of root.sessions) {
    const session = objectRecord(value)
    const id = typeof session?.id === 'string' ? session.id : ''
    const createdAtMs = normalizeNumericTimestamp(session?.time_created)
    if (id && createdAtMs) sourceCreatedAtByKey[id] = createdAtMs
  }
  const timestamps = Object.values(sourceCreatedAtByKey)
  if (timestamps.length === 0) return { status: 'pending' }
  return {
    status: 'ready',
    createdAtMs: Math.min(...timestamps),
    sourceCreatedAtByKey,
    sources: Object.keys(sourceCreatedAtByKey).map((sourceSessionKey) => ({
      agentType: 'opencode' as const,
      sourceSessionKey,
    })),
  }
}

function pathBasenameWithoutJsonl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const basename = normalized.slice(normalized.lastIndexOf('/') + 1)
  return basename.endsWith('.jsonl') ? basename.slice(0, -'.jsonl'.length) : basename
}

function readHeaderRecords(filePath: string): Array<Record<string, unknown>> {
  const descriptor = fs.openSync(filePath, 'r')
  try {
    const size = Math.min(fs.fstatSync(descriptor).size, MAX_HEADER_BYTES)
    if (size === 0) return []
    const buffer = Buffer.allocUnsafe(size)
    const bytesRead = fs.readSync(descriptor, buffer, 0, size, 0)
    return buffer.subarray(0, bytesRead).toString('utf8').split('\n')
      .slice(0, MAX_HEADER_RECORDS)
      .map((line) => safeParse(line))
      .filter((record): record is Record<string, unknown> => record != null)
  } finally {
    fs.closeSync(descriptor)
  }
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null
}

function validBirthtime(value: number): number | null {
  return Number.isFinite(value) && value > 0 ? value : null
}

export function normalizeNativeTimestamp(value: unknown): number | null {
  return normalizeNumericTimestamp(value)
}

function normalizeNumericTimestamp(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  return value < 10_000_000_000 ? Math.round(value * 1000) : Math.round(value)
}
