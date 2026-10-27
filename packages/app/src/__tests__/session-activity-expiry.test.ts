// @covers src/hooks/useSessionActivityNow.ts
// @covers src/features/projects/components/MobileProjectListItem.tsx
// @covers src/features/session-list/display.ts
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { NianSession } from '@shennian/wire'
import { getSessionLiveActivity, getSessionListSummary, SESSION_ACTIVITY_STALE_MS } from '@shennian/shared'
import { nextSessionActivityExpiry } from '../hooks/useSessionActivityNow'

const startedAt = Date.parse('2026-09-11T09:30:00Z')
function workingSession(updatedAt = startedAt): NianSession {
  return { id: 'working', activity: {
    sessionId: 'working', runId: 'run', runPhase: 'tool_running',
    startedAt: new Date(startedAt).toISOString(), updatedAt: new Date(updatedAt).toISOString(),
    toolCallCount: 63,
  } } as NianSession
}

describe('working presentation during weak network', () => {
  it('keeps project coloring independent of connectivity (regression contract)', () => {
    const source = readFileSync(resolve(__dirname, '../features/projects/components/MobileProjectListItem.tsx'), 'utf8')
    expect(source).toMatch(/const isRunning = runningCount > 0\s*\n/)
  })

  it('keeps cached work live until the same deadline at both list levels', () => {
    const session = workingSession()
    const now = startedAt + 60_000
    const deadline = nextSessionActivityExpiry([session], now)!
    expect(deadline).toBe(startedAt + SESSION_ACTIVITY_STALE_MS + 1)
    expect(getSessionLiveActivity(session, { now })).not.toBeNull()
    expect(getSessionListSummary(session, { now }).useActiveColor).toBe(true)
    expect(getSessionLiveActivity(session, { now: deadline })).toBeNull()
    expect(getSessionListSummary(session, { now: deadline }).useActiveColor).toBe(false)
    expect(nextSessionActivityExpiry([session], deadline)).toBeNull()
  })

  it('reschedules on fresh activity, handles multiple runs, and cancels after completion', () => {
    const old = workingSession()
    const fresh = workingSession(startedAt + 120_000)
    expect(nextSessionActivityExpiry([fresh, old], startedAt)).toBe(startedAt + SESSION_ACTIVITY_STALE_MS + 1)
    expect(nextSessionActivityExpiry([fresh], startedAt + 120_000)).toBe(startedAt + 120_000 + SESSION_ACTIVITY_STALE_MS + 1)
    expect(nextSessionActivityExpiry([{ activity: null }], startedAt)).toBeNull()
    expect(getSessionListSummary({ ...old, activity: null }).useActiveColor).toBe(false)
  })
})
