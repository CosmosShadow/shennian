// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/native-session-lifecycle.test.ts

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { renameSyncWithRetry } from '../fs/atomic-rename.js'
import path from 'node:path'
import { resolveShennianPath } from '../config/index.js'

type OwnershipRecord = { version: 1; agentSessionId: string; sessionDir: string }

function ownershipRoot(): string {
  return resolveShennianPath('runtime', 'pi-coding-agent', 'session-owners')
}

function recordPath(agentSessionId: string): string {
  const digest = createHash('sha256').update(agentSessionId).digest('hex')
  return path.join(ownershipRoot(), `${digest}.json`)
}

function isOwnedSessionDir(value: string): boolean {
  const root = path.resolve(resolveShennianPath('runtime', 'pi-coding-agent'))
  const candidate = path.resolve(value)
  const relative = path.relative(root, candidate)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative) &&
    path.basename(candidate) === 'sessions'
}

export function recordPiSessionOwnership(agentSessionId: string, sessionDir: string): void {
  if (!agentSessionId || !isOwnedSessionDir(sessionDir)) throw new Error('pi_session_ownership_invalid')
  const root = ownershipRoot()
  fs.mkdirSync(root, { recursive: true, mode: 0o700 })
  const target = recordPath(agentSessionId)
  const temporary = `${target}.${process.pid}.tmp`
  const record: OwnershipRecord = { version: 1, agentSessionId, sessionDir: path.resolve(sessionDir) }
  fs.writeFileSync(temporary, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 })
  renameSyncWithRetry(temporary, target)
  if (process.platform !== 'win32') fs.chmodSync(target, 0o600)
}

export function deleteOwnedPiSession(agentSessionId: string): 'deleted' | 'already_absent' | 'invalid_identity' {
  if (!agentSessionId || agentSessionId.length > 255 || /[\0\r\n]/.test(agentSessionId)) return 'invalid_identity'
  const target = recordPath(agentSessionId)
  let record: OwnershipRecord
  try {
    record = JSON.parse(fs.readFileSync(target, 'utf8')) as OwnershipRecord
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'already_absent' : 'invalid_identity'
  }
  if (
    record.version !== 1 ||
    record.agentSessionId !== agentSessionId ||
    !isOwnedSessionDir(record.sessionDir)
  ) return 'invalid_identity'
  fs.rmSync(record.sessionDir, { recursive: true, force: true })
  fs.rmSync(target, { force: true })
  return 'deleted'
}
