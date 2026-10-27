// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/personal-sync-metrics.test.ts

export type PersonalSyncLocalCounter =
  | 'canonicalCommits'
  | 'sourceCursorAdvanced'
  | 'indexAcknowledged'
  | 'indexFailed'
  | 'indexDirtyRetained'
  | 'historySnapshots'
  | 'historyPages'
  | 'historyDeltas'
  | 'historyBytesServed'
  | 'relayRequestsSent'
  | 'relayEventsSent'
  | 'relayFramesReceived'
  | 'relayReconnects'
  | 'structuredRejections'
  | 'transientRetries'
  | 'permanentStops'
  | 'quarantinedRecords'

const NAMES: readonly PersonalSyncLocalCounter[] = [
  'canonicalCommits',
  'sourceCursorAdvanced',
  'indexAcknowledged',
  'indexFailed',
  'indexDirtyRetained',
  'historySnapshots',
  'historyPages',
  'historyDeltas',
  'historyBytesServed',
  'relayRequestsSent',
  'relayEventsSent',
  'relayFramesReceived',
  'relayReconnects',
  'structuredRejections',
  'transientRetries',
  'permanentStops',
  'quarantinedRecords',
]

const startedAt = new Date()
let activeSubscriptions = 0
const counters = Object.fromEntries(NAMES.map((name) => [name, 0])) as Record<PersonalSyncLocalCounter, number>

export function recordPersonalSyncLocalMetric(name: PersonalSyncLocalCounter, amount = 1): void {
  if (!Number.isFinite(amount) || amount < 0) throw new Error('personal sync metric amount must be non-negative')
  counters[name] += amount
}

export function setPersonalSyncLocalSubscriptions(value: number): void {
  activeSubscriptions = Math.max(0, Math.floor(value))
}

export function getPersonalSyncLocalMetrics(now = new Date()) {
  const uptimeMs = Math.max(1, now.getTime() - startedAt.getTime())
  const cpu = process.cpuUsage()
  const totalFrames = counters.relayEventsSent + counters.relayRequestsSent + counters.relayFramesReceived
  return {
    generatedAt: now.toISOString(),
    processStartedAt: startedAt.toISOString(),
    activeSubscriptions,
    counters: Object.fromEntries(NAMES.map((name) => [name, counters[name]])),
    health: {
      uptimeSeconds: Math.round(uptimeMs / 1000),
      cpuTimeMs: Math.round((cpu.user + cpu.system) / 1000),
      cpuUtilizationRatio: Number(((cpu.user + cpu.system) / (uptimeMs * 1000)).toFixed(4)),
      relayFramesPerMinute: Number((totalFrames * 60_000 / uptimeMs).toFixed(2)),
    },
    privacy: {
      containsAccountIdentity: false,
      containsSessionIdentity: false,
      containsMessageBody: false,
      containsToolPayload: false,
      containsAttachmentBytes: false,
    },
  }
}

export function resetPersonalSyncLocalMetricsForTests(): void {
  activeSubscriptions = 0
  for (const name of NAMES) counters[name] = 0
}
