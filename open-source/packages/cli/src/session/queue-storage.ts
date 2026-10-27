// @arch open-source/docs/cli-runtime.md

import fs from 'node:fs'
import { renameSyncWithRetry } from '../fs/atomic-rename.js'
import { randomUUID } from 'node:crypto'
import { resolvePersonalSyncV1Path } from '../personal-sync/paths.js'
import type { LocalQueuedChatMessage } from './queue.js'

export type QueueFile = { sessions: Record<string, LocalQueuedChatMessage[]> }

export function readQueue(): QueueFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(resolvePersonalSyncV1Path('outbound-queue.json'), 'utf-8')) as QueueFile
    return { sessions: parsed.sessions && typeof parsed.sessions === 'object' ? parsed.sessions : {} }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT'
      || (error instanceof Error && error.message.startsWith('ENOENT:'))) return { sessions: {} }
    throw error
  }
}

export function writeQueue(queue: QueueFile): void {
  const directory = resolvePersonalSyncV1Path()
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  const target = resolvePersonalSyncV1Path('outbound-queue.json')
  const temp = `${target}.tmp-${process.pid}-${randomUUID()}`
  try {
    fs.writeFileSync(temp, `${JSON.stringify(queue, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    // Windows requires a writable handle for FlushFileBuffers. Reopening the
    // temporary queue file read-only makes fsyncSync fail with EPERM there.
    const descriptor = fs.openSync(temp, 'r+')
    if (typeof descriptor === 'number') {
      try { fs.fsyncSync(descriptor) } finally { fs.closeSync(descriptor) }
    }
    renameSyncWithRetry(temp, target)
  } finally {
    try { fs.unlinkSync(temp) } catch {}
  }
}

export function purgeQueuedSessionData(sessionId: string): void {
  const queue = readQueue()
  if (!queue.sessions[sessionId]) return
  delete queue.sessions[sessionId]
  writeQueue(queue)
}

export function clearPersistedManagerRoomOrigins(): void {
  const queue = readQueue()
  let changed = false
  for (const messages of Object.values(queue.sessions)) {
    for (const message of messages) {
      const trigger = message.trigger
      if (!trigger || (trigger.kind !== 'manager_event' && trigger.kind !== 'manager_worker') || !trigger.roomOrigin) continue
      delete trigger.roomOrigin
      changed = true
    }
  }
  if (changed) writeQueue(queue)
}
