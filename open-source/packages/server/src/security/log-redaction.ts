// @arch open-source/docs/server-runtime.md
// @test src/__tests__/log-redaction.test.ts

import { redactSensitiveRequestUrl } from './sensitive-request-url.js'

const REDACTED = '[redacted]'
const MAX_DEPTH = 12

const SENSITIVE_KEYS = new Set([
  'authorization',
  'xlocalvisitor',
  'cookie',
  'setcookie',
  'apikey',
  'apikeys',
  'accesskey',
  'secretkey',
  'clientsecret',
  'password',
  'secret',
  'token',
  'accesstoken',
  'refreshtoken',
  'machinetoken',
  'pairtoken',
  'pushtoken',
  'sharetoken',
  'shareid',
  'idtoken',
  'identitytoken',
  'devicesecret',
  'browserstate',
  'invite',
  'invitetoken',
  'signature',
  'code',
  'smscode',
  'verificationcode',
  'onetimecode',
  'otp',
  'invitecode',
  'sharecode',
  'ticket',
  'randstr',
  'csrf',
  'csrftoken',
  'xsrftoken',
  'devicesecrethash',
  'credentials',
  'tokenpreview',
  'credentialpreview',
  'secretpreview',
])

function normalizedKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, '').toLowerCase()
}

export function isSensitiveLogKey(key: string): boolean {
  const normalized = normalizedKey(key)
  return (
    SENSITIVE_KEYS.has(normalized) ||
    normalized.endsWith('token') ||
    normalized.endsWith('tokens') ||
    normalized.endsWith('secret') ||
    normalized.endsWith('secrets') ||
    normalized.endsWith('password') ||
    normalized.endsWith('signature') ||
    normalized.endsWith('cookie')
  )
}

export function redactSensitiveLogText(value: string): string {
  return value
    .replace(/(\/(?:api\/)?local-apps\/(?:runtime|shared)\/)[^\s"'<>]+/gi, `$1${REDACTED}`)
    .replace(
      /(https?:\/\/[^/\s"'<>]+\/(?:api\/)?machines\/grants\/)[^/?#\s"'<>]+(\/preview)/gi,
      `$1${REDACTED}$2`,
    )
    .replace(
      /(\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\/(?:api\/)?machines\/grants\/)[^/?#\s]+(\/preview)/gi,
      `$1${REDACTED}$2`,
    )
    .replace(/https?:\/\/[^\s"'<>]+/gi, (url) => url.replace(/[?#].*$/, ''))
    .replace(/\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/[^\s?#]*)(?:[?#][^\s]*)/gi, '$1 $2')
    .replace(/\b(Authorization\s*[:=]\s*)(?:(?:Bearer|Basic)\s+)?[^\s,;}"']+/gi, `$1${REDACTED}`)
    .replace(/\b((?:Cookie|Set-Cookie)\s*[:=]\s*)[^\r\n]+/gi, `$1${REDACTED}`)
    .replace(/Bearer\s+[^\s,"'}]+/gi, `Bearer ${REDACTED}`)
    .replace(
      /([?&](?:token|access|invite|code|signature|ticket|randstr|csrf)=)[^&#\s]+/gi,
      `$1${REDACTED}`,
    )
    .replace(
      /(["']?(?:token|tokenPreview|credentialPreview|secretPreview|accessToken|refreshToken|machineToken|pairToken|pushToken|shareToken|idToken|apiKey|clientSecret|deviceSecret|deviceSecretHash|browserState|inviteToken|inviteCode|shareCode|signature|code|smsCode|verificationCode|oneTimeCode|otp|ticket|randstr|csrf|csrfToken|xsrfToken|password|credentials?)["']?\s*[:=]\s*)(["']?)[^"'\s,;}]+\2/gi,
      `$1$2${REDACTED}$2`,
    )
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, REDACTED)
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, REDACTED)
    .replace(/[A-Za-z0-9_-]{80,}/g, REDACTED)
}

export function redactSensitiveLogValue(
  value: unknown,
  key = '',
  seen = new WeakSet<object>(),
  depth = 0,
): unknown {
  if (key && isSensitiveLogKey(key)) return REDACTED
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'string') return redactSensitiveLogText(value)
  if (typeof value === 'function' || typeof value === 'symbol') return String(value)
  if (value instanceof Date) return value.toISOString()
  if (depth >= MAX_DEPTH) return '[max-depth]'
  if (typeof value !== 'object') return value
  if (seen.has(value)) return '[circular]'
  seen.add(value)

  if (value instanceof Error) {
    const error = {
      name: value.name,
      message: redactSensitiveLogText(value.message),
      stack: value.stack ? redactSensitiveLogText(value.stack) : undefined,
      ...Object.fromEntries(
        Object.entries(value).map(([entryKey, entryValue]) => [
          entryKey,
          redactSensitiveLogValue(entryValue, entryKey, seen, depth + 1),
        ]),
      ),
    }
    seen.delete(value)
    return error
  }

  if (Array.isArray(value)) {
    const result = value.map((item) => redactSensitiveLogValue(item, '', seen, depth + 1))
    seen.delete(value)
    return result
  }

  const result = Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      redactSensitiveLogValue(entryValue, entryKey, seen, depth + 1),
    ]),
  )
  seen.delete(value)
  return result
}

export function serializeErrorForLog(error: Error): {
  type: string
  message: string
  stack: string
  [key: string]: unknown
} {
  const sanitized = redactSensitiveLogValue(error) as Record<string, unknown>
  return {
    ...sanitized,
    type: typeof sanitized.name === 'string' ? sanitized.name : error.name,
    message: typeof sanitized.message === 'string' ? sanitized.message : REDACTED,
    stack: typeof sanitized.stack === 'string' ? sanitized.stack : '',
  }
}

/**
 * Pino formatters only see structured bindings; its hook is the final boundary
 * that also covers plain message strings and interpolated arguments.
 */
export function sanitizePinoLogArguments(args: readonly unknown[]): unknown[] {
  return args.map((value) =>
    typeof value === 'string' ? redactSensitiveLogText(value) : redactSensitiveLogValue(value),
  )
}

export function sanitizePersistedLog<
  T extends {
    path?: string | null
    payload?: unknown
    metadata?: unknown
    errorMessage?: string | null
    errorStack?: string | null
  },
>(entry: T): T {
  return {
    ...entry,
    path: entry.path ? redactSensitiveRequestUrl(entry.path) : entry.path,
    payload: redactSensitiveLogValue(entry.payload),
    metadata: redactSensitiveLogValue(entry.metadata),
    errorMessage: entry.errorMessage
      ? redactSensitiveLogText(entry.errorMessage)
      : entry.errorMessage,
    errorStack: entry.errorStack ? redactSensitiveLogText(entry.errorStack) : entry.errorStack,
  }
}
