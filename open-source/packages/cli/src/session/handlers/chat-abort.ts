// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/session-manager-core.test.ts
import type { SessionManagerRuntime } from '../types.js'
import { noteRunActivity } from '../run-stall.js'
import { noteCoordinationEvent } from '../../project-coordination/runtime.js'
import { revokeManagedRoomContextToken } from './chat-adapter-config.js'

export function emitSyntheticAbort(runtime: SessionManagerRuntime, sessionId: string): void {
  const session = runtime.sessions.get(sessionId)
  const runId = session?.currentRunId
  if (!session || !runId) return

  const seq = session.nextEventSeq
  runtime.runTextAcc.delete(`${sessionId}:${runId}`)
  revokeManagedRoomContextToken(runtime, session)
  session.pendingTextEvent = null
  noteRunActivity(sessionId, session, true)
  session.currentRunId = null
  session.currentRunPhase = null
  session.nextEventSeq = 0
  if (session.heartbeatTimer) {
    clearInterval(session.heartbeatTimer)
    session.heartbeatTimer = null
  }

  runtime.client.sendAgentEvent({
    type: 'event',
    event: 'agent',
    payload: { state: 'aborted', sessionId, runId, seq },
    seq,
    id: `agent-evt-${runId}-${seq}`,
  })
  if (session.journalRunId) {
    runtime.runJournal?.remove(sessionId, session.journalRunId)
    runtime.recoveryBarrier?.end(sessionId)
    session.journalRunId = null
  }
  noteCoordinationEvent(runtime, sessionId, 'aborted')
  runtime.chatQueue?.noteTerminal(sessionId)
}
