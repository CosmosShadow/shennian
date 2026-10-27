// @arch open-source/docs/server-runtime.md
// @test src/__tests__/security-audit.test.ts

import { prisma } from '../lib/prisma.js'

const SAFE_SEGMENT = /^[A-Za-z0-9_.:@-]{1,191}$/

export type SecurityAuditInput = {
  occurredAt?: Date
  eventType: string
  result: 'success' | 'denied' | 'failed'
  actorUserId?: string | null
  deviceId?: string | null
  machineId?: string | null
  roomId?: string | null
  sourceIp?: string | null
  method?: string | null
  path?: string | null
  statusCode?: number | null
  traceId?: string | null
  reasonCode?: string | null
}

export function addCalendarMonths(value: Date, months: number): Date {
  const firstOfTarget = new Date(
    Date.UTC(
      value.getUTCFullYear(),
      value.getUTCMonth() + months,
      1,
      value.getUTCHours(),
      value.getUTCMinutes(),
      value.getUTCSeconds(),
      value.getUTCMilliseconds(),
    ),
  )
  const lastDay = new Date(
    Date.UTC(firstOfTarget.getUTCFullYear(), firstOfTarget.getUTCMonth() + 1, 0),
  ).getUTCDate()
  firstOfTarget.setUTCDate(Math.min(value.getUTCDate(), lastDay))
  return firstOfTarget
}

export function isAuditedPath(path: string): boolean {
  return path.startsWith('/') && path !== '/health' && path !== '/log' && path !== '/log/batch'
}

export function auditEventType(method: string, path: string): string {
  const canonical = path
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      if (!SAFE_SEGMENT.test(segment)) return ':id'
      if (segment.startsWith(':') || /^\d+$/.test(segment) || segment.length > 24) return ':id'
      return segment
    })
    .join('.')
    .slice(0, 80)
  return `http.${method.toLowerCase()}.${canonical || 'root'}`.slice(0, 96)
}

export async function writeSecurityAudit(input: SecurityAuditInput): Promise<void> {
  if (
    !/^(?:account\.deleted|http\.(?:get|post|put|patch|delete|head|options)\.[a-z0-9_.:-]{1,80})$/.test(
      input.eventType,
    )
  )
    return
  const occurredAt = input.occurredAt ?? new Date()
  try {
    await prisma.securityAuditEvent.create({
      data: {
        occurredAt,
        expiresAt: addCalendarMonths(occurredAt, 6),
        eventType: input.eventType,
        result: input.result,
        actorUserId: safeIdentifier(input.actorUserId, 64),
        deviceId: safeIdentifier(input.deviceId, 64),
        machineId: safeIdentifier(input.machineId, 64),
        roomId: safeIdentifier(input.roomId, 191),
        sourceIp:
          input.sourceIp && /^[0-9a-fA-F:.]{2,64}$/.test(input.sourceIp) ? input.sourceIp : null,
        method:
          input.method && /^(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(input.method)
            ? input.method
            : null,
        path: input.path && /^\/[A-Za-z0-9_./:@-]{0,511}$/.test(input.path) ? input.path : null,
        statusCode: input.statusCode ?? null,
        traceId: input.traceId && /^[a-f0-9]{8,32}$/.test(input.traceId) ? input.traceId : null,
        reasonCode:
          input.reasonCode && /^[a-z0-9_.:-]{1,96}$/.test(input.reasonCode)
            ? input.reasonCode
            : null,
      },
    })
  } catch {
    // Audit persistence must not expose request data or take the product offline.
  }
}

function safeIdentifier(value: string | null | undefined, max: number): string | null {
  return value && value.length <= max && SAFE_SEGMENT.test(value) ? value : null
}
