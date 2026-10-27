import { startPersonalCloudHistoryJob, stopPersonalCloudHistoryJob } from './jobs/personal-cloud-history.js'
import { startStewardTaskEventsJob, stopStewardTaskEventsJob } from './jobs/steward-task-events.js'
import { startPersonalRemindersJob, stopPersonalRemindersJob } from './jobs/personal-reminders.js'
import { startInteractiveContentJob, stopInteractiveContentJob } from './jobs/interactive-content.js'
// @arch open-source/docs/server-runtime.md
// @test src/__tests__/worker-runtime.test.ts

import { startConversationSchedulesJob, stopConversationSchedulesJob } from './jobs/conversation-schedules.js'
import { startAgentRoomRecoveryJob, stopAgentRoomRecoveryJob } from './jobs/agent-room-recovery.js'
import { startLogCleanupJob, stopLogCleanupJob } from './jobs/log-cleanup.js'
import {
  startRoomAttachmentMaintenanceJob,
  stopRoomAttachmentMaintenanceJob,
} from './jobs/room-attachment-maintenance.js'
import {
  startRoomMessageRetentionJob,
  stopRoomMessageRetentionJob,
} from './jobs/room-message-retention.js'
import {
  startSecurityAuditCleanupJob,
  stopSecurityAuditCleanupJob,
} from './jobs/security-audit-cleanup.js'
import {
  startVoiceTaskCompletionNotifyJob,
  stopVoiceTaskCompletionNotifyJob,
} from './jobs/voice-task-completion-notify.js'
import {
  startVoiceIncomingCallIntentJob,
  stopVoiceIncomingCallIntentJob,
} from './jobs/voice-incoming-call-intent.js'
import { purgeRetiredPersonalRedisState } from './services/personal-epoch-redis-cleanup.js'
import { withDistributedLease } from './services/distributed-lease.js'
import {
  startTaskCompletionPushWorker,
  stopTaskCompletionPushWorker,
} from './services/task-completion-push.js'
import { startAcpRegistryJob, stopAcpRegistryJob } from './jobs/acp-registry.js'

type MaybePromise = void | Promise<void>

export type WorkerRuntimeDependencies = {
  startup: () => Promise<unknown>
  jobs: Array<{
    name: string
    start: () => void
    stop: () => MaybePromise
  }>
}

const defaultDependencies: WorkerRuntimeDependencies = {
  startup: () => withDistributedLease({
    name: 'personal-epoch-redis-cleanup',
    ttlMs: 30 * 60_000,
    run: purgeRetiredPersonalRedisState,
  }),
  jobs: [
    { name: 'personal-cloud-history', start: startPersonalCloudHistoryJob, stop: stopPersonalCloudHistoryJob },
    { name: 'steward-task-events', start: startStewardTaskEventsJob, stop: stopStewardTaskEventsJob },
    { name: 'personal-reminders', start: startPersonalRemindersJob, stop: stopPersonalRemindersJob },
    { name: 'interactive-content', start: startInteractiveContentJob, stop: stopInteractiveContentJob },
    { name: 'conversation-schedules', start: startConversationSchedulesJob, stop: stopConversationSchedulesJob },
    { name: 'acp-registry-refresh', start: startAcpRegistryJob, stop: stopAcpRegistryJob },
    { name: 'task-completion-push', start: startTaskCompletionPushWorker, stop: stopTaskCompletionPushWorker },
    {
      name: 'voice-task-completion-notify',
      start: startVoiceTaskCompletionNotifyJob,
      stop: stopVoiceTaskCompletionNotifyJob,
    },
    {
      name: 'voice-incoming-call-intent',
      start: startVoiceIncomingCallIntentJob,
      stop: stopVoiceIncomingCallIntentJob,
    },
    { name: 'log-cleanup', start: startLogCleanupJob, stop: stopLogCleanupJob },
    {
      name: 'room-attachment-maintenance',
      start: startRoomAttachmentMaintenanceJob,
      stop: stopRoomAttachmentMaintenanceJob,
    },
    { name: 'agent-room-recovery', start: startAgentRoomRecoveryJob, stop: stopAgentRoomRecoveryJob },
    {
      name: 'security-audit-cleanup',
      start: startSecurityAuditCleanupJob,
      stop: stopSecurityAuditCleanupJob,
    },
    {
      name: 'room-message-retention',
      start: startRoomMessageRetentionJob,
      stop: stopRoomMessageRetentionJob,
    },
  ],
}

export type WorkerRuntime = {
  jobNames: string[]
  stop: () => Promise<void>
}

export async function startWorkerRuntime(
  dependencies: WorkerRuntimeDependencies = defaultDependencies,
  extraJobs: WorkerRuntimeDependencies['jobs'] = [],
): Promise<WorkerRuntime> {
  await dependencies.startup()
  const started: WorkerRuntimeDependencies['jobs'] = []
  try {
    for (const job of [...dependencies.jobs, ...extraJobs]) {
      job.start()
      started.push(job)
    }
  } catch (error) {
    await Promise.allSettled(started.reverse().map((job) => job.stop()))
    throw error
  }

  let stopped = false
  return {
    jobNames: started.map((job) => job.name),
    stop: async () => {
      if (stopped) return
      stopped = true
      await Promise.allSettled([...started].reverse().map((job) => job.stop()))
    },
  }
}
