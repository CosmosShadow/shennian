// @arch open-source/docs/server-runtime.md
// @test src/__tests__/trace-logging.test.ts

import type { FastifyInstance } from 'fastify'
import { randomBytes } from 'crypto'
import { writeLog } from '../services/log.js'
import { isDiagnosticUserId } from '../services/log-policy.js'
import { redactSensitiveRequestUrl } from '../security/sensitive-request-url.js'
import { auditEventType, isAuditedPath, writeSecurityAudit } from '../services/security-audit.js'

function generateTraceId(): string {
  return randomBytes(8).toString('hex')
}

export function tracePathForRequest(url: string): string {
  return redactSensitiveRequestUrl(url)
}

export function shouldSkipAccessLog(url: string): boolean {
  const path = tracePathForRequest(url)
  return (
    path === '/health' ||
    path === '/log' ||
    path === '/log/batch' ||
    path.startsWith('/relay/') ||
    path.startsWith('/channels/wechat/') ||
    path.startsWith('/api/channels/wechat/')
  )
}

function accessRoute(request: { routeOptions?: { url?: string }; url: string }): string {
  return request.routeOptions?.url || tracePathForRequest(request.url)
}

export function sanitizeErrorMessage(message: string): string {
  return message
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/([?&](?:token|access|invite|code)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/[A-Za-z0-9_-]{80,}/g, '[redacted]')
    .slice(0, 500)
}

declare module 'fastify' {
  interface FastifyRequest {
    traceId: string
    requestStartTime: number
  }
}

export async function tracePlugin(app: FastifyInstance) {
  app.decorateRequest('traceId', '')
  app.decorateRequest('requestStartTime', 0)

  app.addHook('onRequest', async (request) => {
    const incoming = request.headers['x-trace-id']
    request.traceId = typeof incoming === 'string' && incoming ? incoming : generateTraceId()
    request.requestStartTime = Date.now()
  })

  app.addHook('onResponse', async (request, reply) => {
    if (shouldSkipAccessLog(request.url)) return

    const durationMs = Date.now() - request.requestStartTime
    const userId = request.userId || null
    const path = accessRoute(request)
    const level = reply.statusCode >= 500 ? 'error' : reply.statusCode >= 400 ? 'warn' : 'info'
    const diagnostic = isDiagnosticUserId(userId)
    const fields = {
      event: 'http.access',
      traceId: request.traceId,
      userId,
      method: request.method,
      path,
      statusCode: reply.statusCode,
      durationMs,
      ...(diagnostic
        ? {
            diagnostic: true,
            deviceId: request.deviceId || undefined,
            machineId: request.machineId || undefined,
          }
        : {}),
    }

    if (level === 'error') request.log.error(fields, 'http access')
    else if (level === 'warn') request.log.warn(fields, 'http access')
    else request.log.info(fields, 'http access')

    void writeLog({
      traceId: request.traceId,
      userId,
      source: 'server',
      type: 'http',
      level,
      method: request.method,
      path,
      statusCode: reply.statusCode,
      durationMs,
      metadata: diagnostic
        ? {
            deviceId: request.deviceId || undefined,
            machineId: request.machineId || undefined,
          }
        : undefined,
    })
    if (isAuditedPath(path)) {
      const params = request.params as { roomId?: unknown } | undefined
      void writeSecurityAudit({
        eventType: auditEventType(request.method, path),
        result: reply.statusCode >= 500 ? 'failed' : reply.statusCode >= 400 ? 'denied' : 'success',
        actorUserId: userId,
        deviceId: request.deviceId || null,
        machineId: request.machineId || null,
        roomId: typeof params?.roomId === 'string' ? params.roomId : null,
        sourceIp: request.ip,
        method: request.method,
        path,
        statusCode: reply.statusCode,
        traceId: request.traceId,
        reasonCode: reply.statusCode >= 400 ? `http_${reply.statusCode}` : null,
      })
    }
  })

  app.addHook('onError', async (request, _reply, error) => {
    request.log.error(
      {
        event: 'http.error',
        traceId: request.traceId,
        userId: request.userId || null,
        method: request.method,
        path: accessRoute(request),
        errorName: error.name,
        errorCode: (error as { code?: unknown }).code,
        errorMessage: sanitizeErrorMessage(error.message),
      },
      'request failed',
    )
  })

  app.addHook('onSend', async (_request, reply) => {
    reply.header('x-trace-id', _request.traceId)
  })
}
