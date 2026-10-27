// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/session-manager-session-tool-detail.test.ts

import crypto from 'node:crypto'
import fs from 'node:fs'
import { renameSyncWithRetry } from '../fs/atomic-rename.js'
import path from 'node:path'
import type { ToolDetailRef } from '@shennian/wire'
import { resolvePersonalSyncV1Path } from '../personal-sync/paths.js'

const MAX_DETAIL_FILES_PER_SESSION = 200
const MAX_DETAIL_BYTES_PER_SESSION = 25 * 1024 * 1024

export type LocalToolDetail = {
  schemaVersion: 1
  sessionId: string
  toolCallId: string
  detailRevision: number
  ts: number
  name: string
  args?: unknown
  result?: unknown
  status: 'running' | 'completed' | 'failed'
  durationMs?: number
  detailRef: ToolDetailRef
}

export function writeToolDetail(detail: Omit<LocalToolDetail, 'schemaVersion'>): void {
  const directory = sessionDirectory(detail.sessionId)
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  atomicWrite(path.join(directory, `${hash(detail.toolCallId)}.json`), {
    schemaVersion: 1,
    ...detail,
  } satisfies LocalToolDetail)
  enforceSessionLimit(directory)
}

export function readToolDetail(sessionId: string, toolCallId: string): LocalToolDetail | null {
  const file = path.join(sessionDirectory(sessionId), `${hash(toolCallId)}.json`)
  if (!fs.existsSync(file)) return null
  try {
    const detail = JSON.parse(fs.readFileSync(file, 'utf8')) as LocalToolDetail
    return detail.schemaVersion === 1 && detail.sessionId === sessionId && detail.toolCallId === toolCallId
      ? detail
      : null
  } catch {
    return null
  }
}

export function purgeToolDetails(sessionId: string): void {
  if (!sessionId) throw new Error('sessionId is required')
  fs.rmSync(sessionDirectory(sessionId), { recursive: true, force: true })
}

function sessionDirectory(sessionId: string): string {
  return resolvePersonalSyncV1Path('tool-details', hash(sessionId))
}
function hash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}
function atomicWrite(file: string, value: unknown): void {
  const temp = `${file}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`
  let descriptor: number | undefined
  try {
    descriptor = fs.openSync(temp, 'wx', 0o600)
    fs.writeFileSync(descriptor, `${JSON.stringify(value)}\n`, 'utf8')
    fs.fsyncSync(descriptor)
    fs.closeSync(descriptor)
    descriptor = undefined
    renameSyncWithRetry(temp, file)
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor)
    try { fs.unlinkSync(temp) } catch {}
  }
}

function enforceSessionLimit(directory: string): void {
  const entries = fs.readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      const file = path.join(directory, name)
      const stat = fs.statSync(file)
      return { file, bytes: stat.size, mtimeMs: stat.mtimeMs }
    })
    .sort((left, right) => left.mtimeMs - right.mtimeMs)
  let bytes = entries.reduce((sum, entry) => sum + entry.bytes, 0)
  while (entries.length > MAX_DETAIL_FILES_PER_SESSION || bytes > MAX_DETAIL_BYTES_PER_SESSION) {
    const oldest = entries.shift()
    if (!oldest) return
    fs.unlinkSync(oldest.file)
    bytes -= oldest.bytes
  }
}
