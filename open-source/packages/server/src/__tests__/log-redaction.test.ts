// @covers open-source/packages/server/src/security/log-redaction.ts
// @covers open-source/packages/server/src/services/log.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    requestLog: { create: vi.fn() },
  },
}))

vi.mock('../lib/prisma.js', () => ({ prisma: mockPrisma }))

import {
  redactSensitiveLogText,
  redactSensitiveLogValue,
  sanitizePinoLogArguments,
  sanitizePersistedLog,
} from '../security/log-redaction.js'
import { writeLog } from '../services/log.js'

const canaries = {
  accessToken: 'access-canary-123456789',
  refreshToken: 'refresh-canary-123456789',
  machineToken: 'machine-canary-123456789',
  pairToken: 'pair-canary-123456789',
  pushToken: 'push-canary-123456789',
  inviteToken: 'unit_invite_00000000000000000000000000000000',
  apiKey: 'sk-test-0000',
  smsCode: '482913',
  code: '730194',
  inviteCode: 'invite-code-canary-123456789',
  csrfToken: 'csrf-canary-123456789',
  deviceSecretHash: 'device-hash-canary-123456789',
  tokenPreview: 'token-prefix-canary-123456789',
}

describe('credential-safe logging', () => {
  const previousDbLog = process.env.SERVER_DB_LOG_ENABLED

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.SERVER_DB_LOG_ENABLED = '1'
  })

  afterEach(() => {
    if (previousDbLog === undefined) delete process.env.SERVER_DB_LOG_ENABLED
    else process.env.SERVER_DB_LOG_ENABLED = previousDbLog
  })

  it('redacts credentials recursively without erasing useful error codes', () => {
    const value = {
      errorCode: 'invalid_token',
      nested: {
        ...canaries,
        authorization: `Bearer ${canaries.accessToken}`,
        cookie: `session=${canaries.refreshToken}`,
      },
      list: [{ deviceSecret: 'device-canary-123456789' }],
    }
    const safe = redactSensitiveLogValue(value)
    const serialized = JSON.stringify(safe)

    for (const canary of Object.values(canaries)) expect(serialized).not.toContain(canary)
    expect(serialized).not.toContain('device-canary-123456789')
    expect(safe).toMatchObject({ errorCode: 'invalid_token' })
  })

  it('redacts credentials embedded in URLs, JSON strings, bearer headers and errors', () => {
    const text = [
      `Bearer ${canaries.accessToken}`,
      `Authorization: Basic ${canaries.refreshToken}`,
      `Cookie: session=${canaries.pairToken}`,
      `password=${canaries.pushToken}`,
      `code=${canaries.code}`,
      `inviteCode=${canaries.inviteCode}`,
      `csrfToken=${canaries.csrfToken}`,
      `deviceSecretHash=${canaries.deviceSecretHash}`,
      `tokenPreview=${canaries.tokenPreview}`,
      `https://shennian.net/relay?token=${canaries.machineToken}`,
      JSON.stringify({ refreshToken: canaries.refreshToken, apiKey: canaries.apiKey }),
    ].join(' ')
    const safe = redactSensitiveLogText(text)
    for (const canary of Object.values(canaries)) expect(safe).not.toContain(canary)

    const entry = sanitizePersistedLog({
      path: `/relay/client?token=${canaries.accessToken}&query=private`,
      errorMessage: `failed Bearer ${canaries.accessToken}`,
      errorStack: `Error: machineToken="${canaries.machineToken}"`,
      payload: { pairToken: canaries.pairToken },
      metadata: { pushToken: canaries.pushToken },
    })
    expect(entry.path).toBe('/relay/client')
    const serialized = JSON.stringify(entry)
    for (const canary of Object.values(canaries)) expect(serialized).not.toContain(canary)
  })

  it('redacts machine invite capabilities embedded in preview URL paths', () => {
    const token = 'private-machine-invite-capability'
    const safe = redactSensitiveLogText(
      `GET /api/machines/grants/${token}/preview failed at https://app.shennian.net/api/machines/grants/${token}/preview`,
    )
    expect(safe).toContain('/machines/grants/[redacted]/preview')
    expect(safe).not.toContain(token)
  })

  it('sanitizes the final database write boundary', async () => {
    await writeLog({
      traceId: 'trace-1',
      source: 'server',
      type: 'internal',
      level: 'error',
      path: `/auth?token=${canaries.accessToken}`,
      payload: { refreshToken: canaries.refreshToken },
      metadata: { nested: { machineToken: canaries.machineToken } },
      errorMessage: `Bearer ${canaries.accessToken}`,
    })

    expect(mockPrisma.requestLog.create).toHaveBeenCalledOnce()
    const serialized = JSON.stringify(mockPrisma.requestLog.create.mock.calls[0])
    for (const canary of Object.values(canaries)) expect(serialized).not.toContain(canary)
    expect(mockPrisma.requestLog.create.mock.calls[0][0].data.path).toBe('/auth')
  })

  it('sanitizes structured bindings and plain Pino message arguments', () => {
    const safe = sanitizePinoLogArguments([
      `request failed Authorization: Bearer ${canaries.accessToken}`,
      { payload: { code: canaries.code, inviteCode: canaries.inviteCode } },
    ])
    const serialized = JSON.stringify(safe)
    expect(serialized).not.toContain(canaries.accessToken)
    expect(serialized).not.toContain(canaries.code)
    expect(serialized).not.toContain(canaries.inviteCode)
  })
})
