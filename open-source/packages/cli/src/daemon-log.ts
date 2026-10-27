import fs from 'node:fs'
import { resolveShennianPath } from './config/index.js'

const DEFAULT_MAX_LINES = 5_000
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024
const TRIM_INTERVAL_MS = 5 * 60_000

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

export function getDaemonLogRetention(): { maxLines: number; maxBytes: number } {
  return {
    maxLines: readPositiveInt(process.env.SHENNIAN_DAEMON_LOG_MAX_LINES, DEFAULT_MAX_LINES),
    maxBytes: readPositiveInt(process.env.SHENNIAN_DAEMON_LOG_MAX_BYTES, DEFAULT_MAX_BYTES),
  }
}

export function trimDaemonLogFile(
  filePath = resolveShennianPath('daemon.log'),
  retention = getDaemonLogRetention(),
): boolean {
  try {
    const stat = fs.statSync(filePath)
    if (stat.size === 0) return false

    const bytesToRead = Math.min(stat.size, retention.maxBytes)
    const fd = fs.openSync(filePath, 'r')
    let text = ''
    try {
      const buffer = Buffer.allocUnsafe(bytesToRead)
      fs.readSync(fd, buffer, 0, bytesToRead, stat.size - bytesToRead)
      text = buffer.toString('utf8')
    } finally {
      fs.closeSync(fd)
    }

    if (bytesToRead < stat.size) {
      const firstNewline = text.indexOf('\n')
      text = firstNewline >= 0 ? text.slice(firstNewline + 1) : ''
    }

    const hadTrailingNewline = text.endsWith('\n')
    let lines = text.split('\n')
    if (hadTrailingNewline) lines = lines.slice(0, -1)
    if (lines.length > retention.maxLines) {
      lines = lines.slice(-retention.maxLines)
    }
    const next = `${lines.join('\n')}${lines.length > 0 ? '\n' : ''}`
    if (next.length === stat.size && bytesToRead === stat.size) return false

    fs.writeFileSync(filePath, next, 'utf8')
    return true
  } catch {
    return false
  }
}

export function startDaemonLogRetention(): ReturnType<typeof setInterval> {
  trimDaemonLogFile()
  return setInterval(() => {
    trimDaemonLogFile()
  }, TRIM_INTERVAL_MS)
}
