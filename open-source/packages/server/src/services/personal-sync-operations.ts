// @arch open-source/docs/server-runtime.md
// @test src/__tests__/personal-sync-operations.test.ts

import { createHash } from 'node:crypto'
import type { SessionSyncRejection } from '@shennian/wire'

export type PersonalSyncCounter =
  | 'historyOpens'
  | 'historyResponses'
  | 'historyDeltas'
  | 'historyBytes'
  | 'historyRedisPublishes'
  | 'historyUnavailable'
  | 'slowConsumerDisconnects'
  | 'indexApplied'
  | 'indexDuplicate'
  | 'indexRejected'
  | 'legacyFramesRejected'
  | 'personalTranscriptWrites'
  | 'personalOssBytes'

const COUNTER_NAMES: readonly PersonalSyncCounter[] = [
  'historyOpens',
  'historyResponses',
  'historyDeltas',
  'historyBytes',
  'historyRedisPublishes',
  'historyUnavailable',
  'slowConsumerDisconnects',
  'indexApplied',
  'indexDuplicate',
  'indexRejected',
  'legacyFramesRejected',
  'personalTranscriptWrites',
  'personalOssBytes',
]

const startedAt = new Date()
let activeSubscriptions = 0
const counters = Object.fromEntries(COUNTER_NAMES.map((name) => [name, 0])) as Record<PersonalSyncCounter, number>
const rejectionCounters = new Map<string, { count: number; retryable: boolean; requiredAction: string }>()
const machineStreamInstallations = new Set<string>()
const sessionScopedInstallations = new Set<string>()

export function recordPersonalSyncOperation(name: PersonalSyncCounter, amount = 1): void {
  if (!Number.isFinite(amount) || amount < 0) throw new Error('personal sync metric amount must be non-negative')
  counters[name] += amount
}

export function setPersonalSyncActiveSubscriptions(value: number): void {
  activeSubscriptions = Math.max(0, Math.floor(value))
}

export function recordPersonalSyncClientCapability(
  installationId: string | null | undefined,
  mode: 'machine_stream' | 'session_scoped',
): void {
  if (!installationId) return
  const key = createHash('sha256').update(installationId).digest('hex')
  if (mode === 'machine_stream') machineStreamInstallations.add(key)
  else sessionScopedInstallations.add(key)
}

export function recordPersonalSyncRejection(rejection: SessionSyncRejection): void {
  const current = rejectionCounters.get(rejection.code)
  rejectionCounters.set(rejection.code, {
    count: (current?.count ?? 0) + 1,
    retryable: rejection.retryable,
    requiredAction: rejection.requiredAction,
  })
}

export function getPersonalSyncOperationsSnapshot(now = new Date()) {
  const snapshot = Object.fromEntries(COUNTER_NAMES.map((name) => [name, counters[name]])) as Record<PersonalSyncCounter, number>
  const observedInstallations = new Set([
    ...machineStreamInstallations,
    ...sessionScopedInstallations,
  ])
  const sessionScopedOnlyInstallations = [...sessionScopedInstallations]
    .filter((key) => !machineStreamInstallations.has(key)).length
  const machineStreamPercent = observedInstallations.size === 0
    ? null
    : Math.round((machineStreamInstallations.size / observedInstallations.size) * 10_000) / 100
  const alerts = [
    ...(snapshot.legacyFramesRejected > 0 ? ['legacy_personal_frames_rejected'] : []),
    ...(snapshot.indexRejected > 0 ? ['personal_index_updates_rejected'] : []),
    ...(snapshot.slowConsumerDisconnects > 0 ? ['personal_history_slow_consumers'] : []),
  ]
  return {
    status: alerts.length === 0 ? 'ok' as const : 'attention' as const,
    generatedAt: now.toISOString(),
    processStartedAt: startedAt.toISOString(),
    activeSubscriptions,
    clientCapabilityAdoption: {
      observedInstallations: observedInstallations.size,
      machineStreamInstallations: machineStreamInstallations.size,
      sessionScopedOnlyInstallations,
      machineStreamPercent,
    },
    counters: snapshot,
    rejections: Object.fromEntries([...rejectionCounters.entries()].sort(([a], [b]) => a.localeCompare(b))),
    alerts,
    privacy: {
      dimensions: ['count', 'bytes', 'revision-outcome'],
      containsSessionIdentity: false,
      containsMessageBody: false,
      containsToolPayload: false,
      containsAttachmentBytes: false,
    },
  }
}

export function resetPersonalSyncOperationsForTests(): void {
  activeSubscriptions = 0
  for (const name of COUNTER_NAMES) counters[name] = 0
  rejectionCounters.clear()
  machineStreamInstallations.clear()
  sessionScopedInstallations.clear()
}
