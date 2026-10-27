// @arch open-source/docs/server-runtime.md
// @test open-source/packages/server/src/__tests__/log-policy.test.ts

import type { LogEntry } from './log.js'

const WS_ENTRY_EVENTS = new Set([
  'machine.connect',
  'machine.disconnect',
  'client.connect',
  'client.disconnect',
  'upgrade.outcome',
  'upgrade.recovery.outcome',
])

const INTERNAL_ENTRY_PATHS = new Set([
  'push.register',
  'push.unregister',
  'push.send',
  'push.delivered',
  'push.task-complete',
])

export function diagnosticUserIds(configured = process.env.SERVER_DIAGNOSTIC_USER_IDS): Set<string> {
  const ids = new Set<string>()
  for (const value of configured?.split(',') ?? []) {
    const id = value.trim()
    if (id) ids.add(id)
  }
  return ids
}

export function isDiagnosticUserId(
  userId: string | null | undefined,
  configured = process.env.SERVER_DIAGNOSTIC_USER_IDS,
): boolean {
  return Boolean(userId && diagnosticUserIds(configured).has(userId))
}

export function shouldRecordLog(
  log: LogEntry,
  configured = process.env.SERVER_DIAGNOSTIC_USER_IDS,
): boolean {
  if (log.level === 'error' || log.level === 'warn') return true
  if (log.type === 'http') return true
  if (log.wsEvent && WS_ENTRY_EVENTS.has(log.wsEvent)) return true
  if (log.path && INTERNAL_ENTRY_PATHS.has(log.path)) return true
  return isDiagnosticUserId(log.userId, configured)
}
