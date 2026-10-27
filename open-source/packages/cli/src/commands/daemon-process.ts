// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/daemon-autostart.test.ts

import { execFileSync } from 'node:child_process'
import os from 'node:os'
import fs from 'node:fs'

const WINDOWS_PROCESS_QUERY_TIMEOUT_MS = 5000

/** A host can see container PIDs; those daemons do not own this Client's state. */
export function isDaemonProcessInCurrentNamespace(pid: number): boolean {
  if (os.platform() !== 'linux') return true
  try {
    return fs.readlinkSync(`/proc/${pid}/ns/pid`) === fs.readlinkSync('/proc/self/ns/pid')
  } catch {
    // Unknown is not proof of a foreign process. Preserve fail-closed liveness
    // when procfs is unavailable or namespace inspection is denied.
    return true
  }
}

/** Only a completed exact-PID query may disprove a permission-denied kill(0). */
function queryWindowsProcessRunning(pid: number): boolean | null {
  try {
    const script = [
      "$ErrorActionPreference = 'Stop'; $ProgressPreference = 'SilentlyContinue'",
      `try { $rows = @(Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}' -ErrorAction Stop)`,
      `[ordered]@{ pid = ${pid}; queryCompleted = $true; running = ($rows.Count -gt 0) } | ConvertTo-Json -Compress`,
      '} catch { exit 1 }',
    ].join('; ')
    const raw = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
      timeout: WINDOWS_PROCESS_QUERY_TIMEOUT_MS, windowsHide: true,
    })
    const value = JSON.parse(raw.trim()) as { pid?: unknown; queryCompleted?: unknown; running?: unknown }
    return value?.pid === pid && value.queryCompleted === true && typeof value.running === 'boolean'
      ? value.running : null
  } catch {
    return null
  }
}

export function isDaemonProcessRunning(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  if (!isDaemonProcessInCurrentNamespace(pid)) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : null
    if (code === 'ESRCH') return false
    if ((code === 'EPERM' || code === 'EACCES') && os.platform() === 'win32') {
      return queryWindowsProcessRunning(pid) ?? true
    }
    // Access refusal or an unknown probe failure never proves that an owner died.
    return true
  }
}

export function isShennianRunServiceCommand(command: string): boolean {
  const normalized = command.replace(/\\/g, '/').trim()
  return (
    isUpdaterWorkerRunServiceCommand(normalized) ||
    isDesktopBridgeRunServiceCommand(normalized) ||
    isNodeRunServiceCommand(normalized) ||
    isShimRunServiceCommand(normalized, 'shennian') ||
    isShimRunServiceCommand(normalized, 'npx')
  )
}

export function inferDaemonLauncherFromCommand(
  command: string,
): 'desktop-managed' | 'global-cli' | 'unknown' {
  const normalized = command.replace(/\\/g, '/').toLowerCase()
  if (
    normalized.includes('/cli-bridge.js') ||
    normalized.includes('/resources/daemon/')
  ) {
    return 'desktop-managed'
  }
  if (
    normalized.includes('/node_modules/shennian/') ||
    normalized.includes('/bin/shennian') ||
    normalized.includes(' shennian run-service') ||
    normalized.includes(' shennian.js run-service')
  ) {
    return 'global-cli'
  }
  return 'unknown'
}

export function parseWindowsDaemonProcessJson(raw: string, excludePid = process.pid): number[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(extractJsonPayload(raw))
  } catch {
    return []
  }
  const rows = Array.isArray(parsed) ? parsed : parsed ? [parsed] : []
  return rows
    .map((row) => {
      if (!row || typeof row !== 'object') return null
      const record = row as { ProcessId?: unknown; CommandLine?: unknown }
      const pid = Number(record.ProcessId)
      const command = typeof record.CommandLine === 'string' ? record.CommandLine : ''
      if (!Number.isInteger(pid) || pid <= 0 || pid === excludePid) return null
      return isShennianRunServiceCommand(command) ? pid : null
    })
    .filter((pid): pid is number => typeof pid === 'number')
}

function extractJsonPayload(raw: string): string {
  const trimmed = raw.trim()
  const startsAt = [...trimmed]
    .map((character, index) => (character === '[' || character === '{' ? index : -1))
    .find((index) => index >= 0) ?? -1
  if (startsAt < 0) return trimmed
  const start = trimmed[startsAt]
  const end = start === '[' ? ']' : '}'
  const endsAt = trimmed.lastIndexOf(end)
  return endsAt >= startsAt ? trimmed.slice(startsAt, endsAt + 1) : trimmed.slice(startsAt)
}

export function findRunningWindowsDaemonProcessIds(excludePid = process.pid): number[] {
  try {
    const script = [
      "$ProgressPreference = 'SilentlyContinue'",
      "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'run-service' } | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress",
    ].join('; ')
    const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: WINDOWS_PROCESS_QUERY_TIMEOUT_MS,
      windowsHide: true,
    })
    return parseWindowsDaemonProcessJson(output, excludePid)
  } catch {
    return []
  }
}

export function readWindowsProcessCommand(pid: number): string | null {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null
  try {
    const script = [
      "$ProgressPreference = 'SilentlyContinue'",
      `Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" | Select-Object -ExpandProperty CommandLine`,
    ].join('; ')
    const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: WINDOWS_PROCESS_QUERY_TIMEOUT_MS,
      windowsHide: true,
    }).trim()
    return output || null
  } catch {
    return null
  }
}

function isUpdaterWorkerRunServiceCommand(command: string): boolean {
  return (
    /(?:^|["\s])[^"\s]*updater-worker\.js["\s]/i.test(command) &&
    /(?:^|["\s])--service(?:["\s]|$)/i.test(command) &&
    /(?:^|["\s])run-service(?:["\s]|$)/i.test(command)
  )
}

function isDesktopBridgeRunServiceCommand(command: string): boolean {
  return (
    /(?:^|["\s])[^"\s]*shennianclient\.exe["\s]/i.test(command) &&
    /(?:^|["\s])[^"\s]*cli-bridge\.js["\s]/i.test(command) &&
    /(?:^|["\s])[^"\s]*\/daemon\/dist\/bin\/shennian\.js["\s]/i.test(command) &&
    /(?:^|["\s])run-service(?:["\s]|$)/i.test(command)
  )
}

function isNodeRunServiceCommand(command: string): boolean {
  return (
    /^"[^"]*\/node(?:\.exe)?"\s+"?[^"]*(?:\/node_modules\/shennian\/|\/dist\/bin\/shennian\.js|\/bin\/shennian)"?\s+run-service(?:\s|$)/i.test(command) ||
    /^(?:\S*\/)?node(?:\.exe)?\s+\S*(?:\/node_modules\/shennian\/|\/dist\/bin\/shennian\.js|\/bin\/shennian)\s+run-service(?:\s|$)/i.test(command)
  )
}

function isShimRunServiceCommand(command: string, basename: 'shennian' | 'npx'): boolean {
  const executable = basename === 'shennian'
    ? `${basename}(?:\\.cmd|\\.exe)?`
    : `${basename}(?:\\.cmd|\\.exe)?`
  const suffix = basename === 'npx'
    ? '\\s+(?:--yes\\s+)?shennian\\s+run-service(?:\\s|$)'
    : '\\s+run-service(?:\\s|$)'
  return new RegExp(`^"[^"]*\\/${executable}"${suffix}`, 'i').test(command) ||
    new RegExp(`^(?:\\S*\\/)?${executable}${suffix}`, 'i').test(command)
}
