export type LogReportEntry = {
  traceId?: string
  userId?: string
  machineId?: string
  sessionId?: string
  source?: 'app' | 'cli'
  type?: 'http' | 'ws' | 'internal'
  level: 'debug' | 'info' | 'warn' | 'error'
  method?: string
  path?: string
  statusCode?: number
  wsEvent?: string
  wsDirection?: 'in' | 'out'
  payload?: unknown
  errorMessage?: string
  errorStack?: string
  durationMs?: number
  metadata?: unknown
  clientTs?: string
  instanceId?: string
}

export function initLogReporter(
  getBaseUrl: () => string,
  defaults?: Partial<LogReportEntry>,
): void {
  // Remote DB log reporting is intentionally disabled; keep the API for callers.
  void getBaseUrl
  void defaults
}

export function reportLog(entry: LogReportEntry): void {
  // Remote DB log reporting is intentionally disabled; keep the API for callers.
  void entry
}
