// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/daemon-autostart.test.ts

import type { DaemonStatus } from './daemon.js'

const DEFAULT_DAEMON_START_WAIT_MS = 20_000
const DEFAULT_DAEMON_START_POLL_MS = 500

export function isDaemonReadyStatus(
  status: Pick<DaemonStatus, 'running' | 'stale' | 'adopted' | 'instanceId'>,
  excludedInstanceId?: string,
): boolean {
  // Discovery alone can briefly see Electron running in GUI mode before exit.
  // A newly started daemon must publish its own PID record, not just an argv match.
  return (
    status.running === true &&
    status.stale !== true &&
    status.adopted !== true &&
    (!excludedInstanceId || status.instanceId !== excludedInstanceId)
  )
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

export function waitForDaemonReadyStatus(
  readStatus: () => DaemonStatus,
  opts: {
    timeoutMs?: number
    intervalMs?: number
    excludedInstanceId?: string
    now?: () => number
    sleep?: (ms: number) => void
  } = {},
): DaemonStatus {
  const timeoutMs = Math.max(0, opts.timeoutMs ?? DEFAULT_DAEMON_START_WAIT_MS)
  const intervalMs = Math.max(1, opts.intervalMs ?? DEFAULT_DAEMON_START_POLL_MS)
  const now = opts.now ?? Date.now
  const sleep = opts.sleep ?? sleepSync
  const deadline = now() + timeoutMs
  let latest = readStatus()
  const isExpectedInstanceReady = (status: DaemonStatus) =>
    isDaemonReadyStatus(status, opts.excludedInstanceId)

  while (!isExpectedInstanceReady(latest) && now() < deadline) {
    const remaining = Math.max(1, deadline - now())
    sleep(Math.min(intervalMs, remaining))
    latest = readStatus()
  }

  return latest
}
