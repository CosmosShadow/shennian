import type { FastifyInstance } from 'fastify'
import { isDbLogEnabled, writeLog } from '../services/log.js'
import type { LogSource, LogType, LogLevel } from '../services/log.js'

type LogRequestBody = {
  traceId: string
  userId?: string
  machineId?: string
  sessionId?: string
  source: LogSource
  type: LogType
  level: LogLevel
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
}

type BatchLogRequestBody = {
  logs: LogRequestBody[]
}

const VALID_SOURCES = new Set(['app', 'server', 'cli'])
const VALID_TYPES = new Set(['http', 'ws', 'internal'])
const VALID_LEVELS = new Set(['debug', 'info', 'warn', 'error'])

function isValidLog(log: LogRequestBody): boolean {
  return (
    typeof log.traceId === 'string' &&
    log.traceId.length > 0 &&
    VALID_SOURCES.has(log.source) &&
    VALID_TYPES.has(log.type) &&
    VALID_LEVELS.has(log.level)
  )
}

export async function logRoutes(app: FastifyInstance) {
  app.post<{ Body: LogRequestBody }>('/log', async (request, reply) => {
    const log = request.body
    if (!log || !isValidLog(log)) {
      return reply.code(400).send({ error: 'Invalid log entry' })
    }
    void writeLog(log)
    return { ok: true, disabled: !isDbLogEnabled() }
  })

  app.post<{ Body: BatchLogRequestBody }>('/log/batch', async (request, reply) => {
    const { logs } = request.body ?? {}
    if (!Array.isArray(logs) || logs.length === 0) {
      return reply.code(400).send({ error: 'Invalid batch' })
    }
    const valid = logs.filter(isValidLog)
    for (const log of valid) {
      void writeLog(log)
    }
    return { ok: true, disabled: !isDbLogEnabled(), accepted: valid.length, rejected: logs.length - valid.length }
  })
}
