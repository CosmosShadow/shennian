// @arch open-source/docs/cli-runtime.md
// @test open-source/packages/cli/src/__tests__/updater-protocol.test.ts

export const UPDATER_PROTOCOL_VERSION = 1 as const

export type UpdaterJob = {
  protocolVersion: typeof UPDATER_PROTOCOL_VERSION
  jobId: string
  fromVersion: string
  targetVersion: string
  npmPrefix: string
  npmExecutable: string
  nodeExecutable: string
  packageName: 'shennian'
  operation: 'upgrade' | 'rollback'
  oldDaemonPid: number | null
  platform: NodeJS.Platform
  createdAt: string
  daemonExitTimeoutMs: number
  commandTimeoutMs: number
  resultPath: string
  attemptPath: string
  /** Release-smoke only: bypass installed platform service and use exact-bin fallback. */
  isolatedDaemonStart?: boolean
  /** Original local installation transaction used by crash-loop recovery. */
  rollbackJobId?: string
  requireHandoffAck?: boolean
}

export type UpdaterResultState =
  | 'waiting_for_daemon'
  | 'installing'
  | 'verifying'
  | 'starting'
  | 'healthy'
  | 'rolled_back'
  | 'failed'

export type UpdaterErrorCode =
  | 'invalid_job'
  | 'job_expired'
  | 'upgrade_locked'
  | 'daemon_exit_timeout'
  | 'npm_install_failed'
  | 'verification_failed'
  | 'rollback_failed'
  | 'daemon_start_failed'
  | 'internal_error'

export type UpdaterResult = {
  protocolVersion: typeof UPDATER_PROTOCOL_VERSION
  jobId: string
  state: UpdaterResultState
  fromVersion: string
  targetVersion: string
  operation?: 'upgrade' | 'rollback'
  effectiveVersion?: string
  errorCode?: UpdaterErrorCode
  errorSummary?: string
  updatedAt: string
}

const SEMVER = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

export function parseUpdaterJob(value: unknown): UpdaterJob {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_job')
  const input = value as Record<string, unknown>
  const required = (key: string): string => {
    const candidate = input[key]
    if (typeof candidate !== 'string' || !candidate.trim()) throw new Error('invalid_job')
    return candidate
  }
  if (input.protocolVersion !== UPDATER_PROTOCOL_VERSION) throw new Error('invalid_job')
  const fromVersion = required('fromVersion')
  const targetVersion = required('targetVersion')
  if (!SEMVER.test(fromVersion) || !SEMVER.test(targetVersion)) throw new Error('invalid_job')
  const createdAt = required('createdAt')
  if (!Number.isFinite(Date.parse(createdAt))) throw new Error('invalid_job')
  if (input.packageName !== 'shennian') throw new Error('invalid_job')
  const oldDaemonPid = input.oldDaemonPid == null ? null : Number(input.oldDaemonPid)
  if (oldDaemonPid != null && (!Number.isSafeInteger(oldDaemonPid) || oldDaemonPid <= 0)) {
    throw new Error('invalid_job')
  }
  const daemonExitTimeoutMs = Number(input.daemonExitTimeoutMs)
  const commandTimeoutMs = Number(input.commandTimeoutMs)
  if (!Number.isSafeInteger(daemonExitTimeoutMs) || daemonExitTimeoutMs < 1_000) throw new Error('invalid_job')
  if (!Number.isSafeInteger(commandTimeoutMs) || commandTimeoutMs < 10_000) throw new Error('invalid_job')
  return {
    protocolVersion: UPDATER_PROTOCOL_VERSION,
    jobId: required('jobId'),
    fromVersion,
    targetVersion,
    npmPrefix: required('npmPrefix'),
    npmExecutable: required('npmExecutable'),
    nodeExecutable: required('nodeExecutable'),
    packageName: 'shennian',
    operation: input.operation === 'rollback' ? 'rollback' : 'upgrade',
    oldDaemonPid,
    platform: required('platform') as NodeJS.Platform,
    createdAt,
    daemonExitTimeoutMs,
    commandTimeoutMs,
    resultPath: required('resultPath'),
    attemptPath: required('attemptPath'),
    isolatedDaemonStart: input.isolatedDaemonStart === true,
    requireHandoffAck: input.requireHandoffAck === true,
    ...(typeof input.rollbackJobId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(input.rollbackJobId) ? { rollbackJobId: input.rollbackJobId } : {}),
  }
}

export function sanitizeUpdaterError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw
    .replace(/[A-Za-z]:\\[^\s]+|\/(?:[^\s/]+\/)+[^\s]+/g, '<path>')
    .replace(/(token|password|secret|authorization)\s*[=:]\s*[^\s]+/gi, '$1=<redacted>')
    .replace(/\s+/g, ' ')
    .slice(0, 500)
}
