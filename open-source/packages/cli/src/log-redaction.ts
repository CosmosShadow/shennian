// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/log-redaction.test.ts

const REDACTED = '[redacted]'

export function redactCliLogText(value: string, knownSecrets: readonly string[] = []): string {
  let safe = value
  for (const secret of knownSecrets) {
    if (secret.length >= 6) safe = safe.split(secret).join(REDACTED)
  }
  return safe
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
      /(["']?(?:auth|token|secret|ipcSecret|daemonIpcSecret|tokenPreview|credentialPreview|secretPreview|accessToken|refreshToken|machineToken|pairToken|pushToken|shareToken|idToken|apiKey|clientSecret|deviceSecret|deviceSecretHash|browserState|inviteToken|inviteCode|shareCode|signature|code|smsCode|verificationCode|oneTimeCode|otp|ticket|randstr|csrf|csrfToken|xsrfToken|password|credentials?)["']?\s*[:=]\s*)(["']?)[^"'\s,;}]+\2/gi,
      `$1$2${REDACTED}$2`,
    )
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, REDACTED)
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, REDACTED)
    .replace(/[A-Za-z0-9_-]{80,}/g, REDACTED)
}

function isSensitiveCliLogKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase()
  return (
    normalized === 'apikey' ||
    normalized === 'apikeys' ||
    normalized === 'credentials' ||
    normalized === 'tokenpreview' ||
    normalized === 'credentialpreview' ||
    normalized === 'secretpreview' ||
    normalized === 'authorization' ||
    normalized === 'cookie' ||
    normalized === 'code' ||
    normalized === 'smscode' ||
    normalized === 'verificationcode' ||
    normalized === 'onetimecode' ||
    normalized === 'otp' ||
    normalized === 'invitecode' ||
    normalized === 'sharecode' ||
    normalized === 'ticket' ||
    normalized === 'randstr' ||
    normalized === 'csrf' ||
    normalized === 'csrftoken' ||
    normalized === 'xsrftoken' ||
    normalized === 'devicesecrethash' ||
    normalized.endsWith('token') ||
    normalized.endsWith('tokens') ||
    normalized.endsWith('secret') ||
    normalized.endsWith('secrets') ||
    normalized.endsWith('password') ||
    normalized.endsWith('signature')
  )
}

export function sanitizeCliLogValue(
  value: unknown,
  knownSecrets: readonly string[] = [],
  key = '',
  depth = 0,
  seen = new WeakSet<object>(),
): unknown {
  if (key && isSensitiveCliLogKey(key)) return REDACTED
  if (typeof value === 'string') return redactCliLogText(value, knownSecrets)
  if (value instanceof Error) {
    const safe = new Error(redactCliLogText(value.message, knownSecrets))
    safe.name = value.name
    safe.stack = value.stack ? redactCliLogText(value.stack, knownSecrets) : undefined
    return safe
  }
  if (value && typeof value === 'object') {
    if (depth >= 10) return '[max-depth]'
    if (seen.has(value)) return '[circular]'
    seen.add(value)
    if (Array.isArray(value)) {
      const safe = value.map((item) => sanitizeCliLogValue(item, knownSecrets, '', depth + 1, seen))
      seen.delete(value)
      return safe
    }
    const safe = Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        sanitizeCliLogValue(entryValue, knownSecrets, entryKey, depth + 1, seen),
      ]),
    )
    seen.delete(value)
    return safe
  }
  return value
}

export function collectKnownLogSecrets(env: NodeJS.ProcessEnv, config: unknown): string[] {
  const values = new Set<string>()
  const secretKey = /(token|secret|password|api[_-]?key|authorization|cookie|signature)/i
  for (const [key, value] of Object.entries(env)) {
    if (value && value.length >= 6 && secretKey.test(key)) values.add(value)
  }
  const visit = (value: unknown, key = '', depth = 0) => {
    if (depth > 8 || value == null) return
    if (typeof value === 'string') {
      if (value.length >= 6 && secretKey.test(key)) values.add(value)
      return
    }
    if (typeof value !== 'object') return
    for (const [entryKey, entryValue] of Object.entries(value))
      visit(entryValue, entryKey, depth + 1)
  }
  visit(config)
  return [...values]
}

let installed = false

export function installCliLogRedaction(knownSecrets: readonly string[]): void {
  if (installed) return
  installed = true
  for (const level of ['log', 'info', 'warn', 'error'] as const) {
    const original = console[level].bind(console)
    console[level] = (...args: unknown[]) => {
      original(...args.map((value) => sanitizeCliLogValue(value, knownSecrets)))
    }
  }
}
