// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/run-stall.test.ts
import { upsertMessage } from './store.js'
import type { ActiveSession } from './types.js'

const DEFAULT_RUN_STALL_MS = 10 * 60_000

/** Silence after which a run is reported as possibly stuck; `SHENNIAN_RUN_STALL_MS` overrides it. */
export function runStallThresholdMs(): number {
  const override = Number(process.env.SHENNIAN_RUN_STALL_MS)
  return Number.isFinite(override) && override >= 1_000 ? override : DEFAULT_RUN_STALL_MS
}

// Waiting for the user is silence by design, not a fault of the Agent.
const SILENT_BY_DESIGN = new Set(['waiting_approval', 'waiting_user_input'])

function stallNotice(silentMs: number): string {
  const minutes = Math.max(1, Math.round(silentMs / 60_000))
  return `AI 已经 ${minutes} 分钟没有任何输出，可能卡住了。如果它正在执行耗时很长的命令，可以继续等待；否则请点击“停止”后重新发送。神念不会自动中断它，后面排队的消息会等这一轮结束。`
}

/**
 * Reports runs that have produced nothing for a long time. Deliberately does not clear the
 * activity indicator: clients only offer "Stop" while a run looks active, and stopping is exactly
 * what a stuck run needs. Every provider event (including thinking, tool and heartbeat events)
 * counts as activity, so a long but progressing run is never flagged.
 */
export function checkRunStalls(
  sessions: Iterable<[string, ActiveSession]>,
  publish: () => void,
  now = Date.now(),
  thresholdMs = runStallThresholdMs(),
): string[] {
  const stalled: string[] = []
  for (const [sessionId, session] of sessions) {
    if (!session.currentRunId || session.stalledNotice) continue
    if (session.currentRunPhase && SILENT_BY_DESIGN.has(session.currentRunPhase)) continue
    if (session.lastProviderActivityAt === undefined) continue
    const silentMs = now - session.lastProviderActivityAt
    if (silentMs < thresholdMs) continue
    const notice = { id: `run-stalled-${session.currentRunId}`, ts: now }
    session.stalledNotice = notice
    upsertMessage(sessionId, {
      id: notice.id, sessionId, role: 'agent', ts: notice.ts, payload: stallNotice(silentMs),
    })
    publish()
    stalled.push(sessionId)
  }
  return stalled
}

/** Called for every provider event: the run is alive again, or it has ended. */
export function noteRunActivity(sessionId: string, session: ActiveSession, ended: boolean): void {
  session.lastProviderActivityAt = Date.now()
  const notice = session.stalledNotice
  if (!notice) return
  session.stalledNotice = null
  upsertMessage(sessionId, {
    id: notice.id, sessionId, role: 'agent', ts: notice.ts,
    payload: ended ? '这一轮已经结束，上面“可能卡住”的提示无需处理。' : 'AI 已恢复输出，上面“可能卡住”的提示无需处理。',
  })
}
