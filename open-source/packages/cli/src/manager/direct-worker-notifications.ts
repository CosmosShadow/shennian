// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/steward-delegation.test.ts
import type { ManagerRegistry, ManagerRecord, ManagerInboxEvent } from './registry.js'
import type { SessionManagerRuntime } from '../session/types.js'
import { getCanonicalSessionStore } from '../session/store.js'
import { requestSessionIndexPublish } from '../session/index-publisher.js'
import { commitStewardSay } from '../session/handlers/steward.js'

/** Persist the user notification before releasing inbox ownership; no model call. */
export function deliverDirectWorkerEvents(runtime: SessionManagerRuntime, registry: ManagerRegistry, manager: ManagerRecord, events: ManagerInboxEvent[]) {
  if (!manager.stewardSessionId) throw new Error('personal_worker_context_invalid')
  for (const event of events) {
    const worker = registry.getWorkerForManager(manager.sessionId, event.workerSessionId)
    if (!worker) throw new Error('personal_worker_context_invalid')
    const messageId = `worker-notify:${event.id}`
    if (getCanonicalSessionStore().getMessageState(manager.stewardSessionId, messageId)) {
      requestSessionIndexPublish(runtime.client)
      registry.removeInboxEvents(manager.sessionId, [event.id])
      continue
    }
    const title = worker.title?.slice(0, 500) || '后台任务'
    const label = event.kind === 'worker.final' ? '执行结束' : event.kind === 'worker.error' ? '执行失败' : event.kind === 'worker.aborted' ? '已停止' : '进展'
    commitStewardSay(runtime, manager.stewardSessionId, `${title} · ${label}\n${event.summary}`.slice(0, 20000), 'say', messageId, {
      id: worker.sessionId, title, scheduleId: manager.scheduleId, state: event.kind,
    })
    registry.removeInboxEvents(manager.sessionId, [event.id])
  }
}
