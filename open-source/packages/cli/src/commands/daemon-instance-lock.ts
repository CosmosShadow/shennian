// @arch open-source/docs/cli-runtime.md
// @test open-source/packages/cli/src/__tests__/daemon-instance-lock.test.ts

import fs from 'node:fs'
import path from 'node:path'
import { isDaemonProcessRunning } from './daemon-process.js'

export type DaemonInstanceLock = {
  acquired: true
  release: () => void
} | {
  acquired: false
  ownerPid: number | null
}

type LockRecord = {
  pid: number
  instanceId: string
}

// A restarted container commonly reuses PID 1. A persisted record for our own
// PID cannot belong to another process in this namespace. Keep an in-process
// guard as well so a second acquisition in this process cannot steal a live
// lock from the first caller.
const heldLockPaths = new Map<string, number>()

function readLockRecord(lockPath: string): LockRecord | null {
  let raw: string
  try {
    raw = fs.readFileSync(lockPath, 'utf8')
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null
    throw lockFailure('read', error)
  }
  try {
    const parsed = JSON.parse(raw) as Partial<LockRecord>
    return Number.isInteger(parsed.pid) && Number(parsed.pid) > 0 && typeof parsed.instanceId === 'string'
      ? { pid: Number(parsed.pid), instanceId: parsed.instanceId }
      : null
  } catch {
    return null
  }
}

function lockFailure(operation: string, error: unknown): Error {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'unknown'
  return Object.assign(new Error(`daemon_instance_lock_${operation}_failed: ${code}`), { code })
}

/**
 * Hold an atomic, cross-process lock for the entire daemon lifetime. The pid
 * file remains the public status record; this private lock closes the
 * read-before-write race when Desktop, a terminal, and an OS service start at
 * the same time.
 */
export function acquireDaemonInstanceLock(options: {
  lockPath: string
  instanceId: string
  pid?: number
  isProcessAlive?: (pid: number) => boolean
  now?: () => number
  malformedStaleAfterMs?: number
}): DaemonInstanceLock {
  const pid = options.pid ?? process.pid
  const isAlive = options.isProcessAlive ?? isDaemonProcessRunning
  const now = options.now ?? Date.now
  const malformedStaleAfterMs = options.malformedStaleAfterMs ?? 5_000
  fs.mkdirSync(path.dirname(options.lockPath), { recursive: true })
  const lockKey = path.join(fs.realpathSync(path.dirname(options.lockPath)), path.basename(options.lockPath))
  const heldPid = heldLockPaths.get(lockKey)
  if (heldPid !== undefined) return { acquired: false, ownerPid: heldPid }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const fd = fs.openSync(options.lockPath, 'wx', 0o600)
      fs.writeFileSync(fd, JSON.stringify({ pid, instanceId: options.instanceId }))
      fs.fsyncSync(fd)
      heldLockPaths.set(lockKey, pid)
      let released = false
      return {
        acquired: true,
        release: () => {
          if (released) return
          released = true
          heldLockPaths.delete(lockKey)
          fs.closeSync(fd)
          const current = readLockRecord(options.lockPath)
          if (current?.pid !== pid || current.instanceId !== options.instanceId) return
          try {
            fs.unlinkSync(options.lockPath)
          } catch {
            // Another shutdown path may already have removed the lock.
          }
        },
      }
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : null
      if (code !== 'EEXIST') throw error
      const owner = readLockRecord(options.lockPath)
      let before: fs.Stats
      try { before = fs.statSync(options.lockPath) } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') continue
        throw lockFailure('inspect', error)
      }
      const persistedSelfPid = owner?.pid === process.pid && pid === process.pid
      if (owner && !persistedSelfPid && isAlive(owner.pid)) return { acquired: false, ownerPid: owner.pid }
      if (!owner) {
        const ageMs = Math.max(0, now() - before.mtimeMs)
        // A second process can observe the file between exclusive open and write.
        if (ageMs < malformedStaleAfterMs) return { acquired: false, ownerPid: null }
      }
      try {
        const current = readLockRecord(options.lockPath)
        const after = fs.statSync(options.lockPath)
        if (current?.pid !== owner?.pid || current?.instanceId !== owner?.instanceId ||
          before.dev !== after.dev || before.ino !== after.ino || before.mtimeMs !== after.mtimeMs) continue
        fs.unlinkSync(options.lockPath)
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') continue
        throw lockFailure('cleanup', error)
      }
    }
  }
  const owner = readLockRecord(options.lockPath)
  return { acquired: false, ownerPid: owner?.pid ?? null }
}
