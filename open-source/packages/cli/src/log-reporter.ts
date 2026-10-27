import crypto from 'node:crypto'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'
type LogType = 'http' | 'ws' | 'internal'

type LogEntry = {
  traceId?: string
  sessionId?: string
  type?: LogType
  level: LogLevel
  wsEvent?: string
  wsDirection?: 'in' | 'out'
  errorMessage?: string
  errorStack?: string
  durationMs?: number
  metadata?: unknown
}

let _serverUrl: string | undefined
let _machineId: string | undefined

export function initCliLogReporter(serverUrl: string, machineId: string): void {
  _serverUrl = serverUrl.replace(/\/$/, '')
  _machineId = machineId
}

export function generateTraceId(): string {
  return crypto.randomBytes(8).toString('hex')
}

export function reportLog(entry: LogEntry): void {
  if (!_serverUrl || !_machineId) return
  // Remote DB log reporting is intentionally disabled; keep the API for callers.
  void entry
}

export type UpgradeAggregateMetric = {
  kind: 'upgrade'
  result: 'healthy' | 'rolled_back' | 'failed'
  stage: 'installing' | 'verifying' | 'starting' | 'recovering' | 'terminal'
  durationMs?: number
  retries?: number
  errorCode?: string
}

export type RecoveryAggregateMetric = {
  kind: 'recovery'
  result: 'terminal_reconciled' | 'reattached' | 'resumed' | 'continued'
    | 'interrupted_by_upgrade' | 'recovery_failed'
  adapterType: string
  stage: 'inspect' | 'reattach' | 'resume' | 'continue' | 'terminal'
  durationMs: number
  retries: number
  errorCode?: string
}

function safeDimension(value: string, fallback: string): string {
  return /^[A-Za-z0-9:_.-]{1,64}$/.test(value) ? value : fallback
}

/**
 * The general remote logger remains disabled. This deliberately narrow path
 * emits only enumerated aggregate dimensions: its type cannot accept session,
 * prompt, filesystem, attachment, tool, token, or stderr fields.
 */
export function reportUpgradeAggregateMetric(
  metric: UpgradeAggregateMetric | RecoveryAggregateMetric,
): void {
  if (!_serverUrl) return
  const durationMs = Math.max(0, Math.min(86_400_000, Math.floor(metric.durationMs ?? 0)))
  const retries = Math.max(0, Math.min(100, Math.floor(metric.retries ?? 0)))
  const wsEvent = metric.kind === 'recovery' ? 'upgrade.recovery.outcome' : 'upgrade.outcome'
  const metadata = {
    kind: metric.kind,
    result: metric.result,
    stage: metric.stage,
    durationMs,
    retries,
    ...(metric.kind === 'recovery'
      ? { adapterType: safeDimension(metric.adapterType, 'unknown') }
      : {}),
    ...(metric.errorCode ? { errorCode: safeDimension(metric.errorCode, 'unknown') } : {}),
  }
  fetch(`${_serverUrl}/log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      traceId: generateTraceId(),
      source: 'cli',
      type: 'internal',
      level: metric.result === 'recovery_failed' || metric.result === 'failed' ? 'warn' : 'info',
      wsEvent,
      durationMs,
      metadata,
    }),
  }).catch(() => {})
}
