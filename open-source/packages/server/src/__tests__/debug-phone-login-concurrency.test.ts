// @covers open-source/packages/server/src/services/auth-session.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const values = new Map<string, string>()
  return {
    values,
    redis: {
      set: vi.fn(async (key: string, value: string, ...args: string[]) => {
        if (args.includes('NX') && values.has(key)) return null
        values.set(key, value)
        return 'OK'
      }),
      get: vi.fn(async (key: string) => values.get(key) ?? null),
      del: vi.fn(async (key: string) => values.delete(key) ? 1 : 0),
      eval: vi.fn(async (_script: string, _keyCount: number, key: string, expected: string) => {
        if (values.get(key) !== expected) return 0
        values.delete(key)
        return 1
      }),
    },
    findUnique: vi.fn(),
    grantTrial: vi.fn(),
  }
})

vi.mock('../lib/redis.js', () => ({ redis: mocks.redis }))
vi.mock('../lib/prisma.js', () => ({
  prisma: {
    user: {
      findUnique: mocks.findUnique,
      create: vi.fn(),
    },
  },
}))
vi.mock('../relay/connection-control.js', () => ({ publishDeviceRevoked: vi.fn() }))
vi.mock('../services/plan-access.js', () => ({ grantInitialProTrial: mocks.grantTrial }))
vi.mock('../services/sms.js', () => ({ sendSmsCode: vi.fn() }))
vi.mock('../services/captcha.js', () => ({ verifyTencentCaptcha: vi.fn() }))

import {
  issueDebugPhoneLoginCode,
  verifyPhoneIdentity,
} from '../services/auth-session.js'

const debugPhone = '+8619900000001'
const originalNodeEnv = process.env.NODE_ENV
const originalDebugEnabled = process.env.SHENNIAN_TEST_LOGIN_ENABLED

describe('debug phone login concurrency', () => {
  beforeEach(() => {
    vi.stubEnv('SHENNIAN_TEST_LOGIN_PHONE', '+8619900000001')
    vi.clearAllMocks()
    mocks.values.clear()
    mocks.findUnique.mockResolvedValue({ id: 'debug-user', phone: debugPhone, name: 'Existing User' })
    mocks.grantTrial.mockResolvedValue(undefined)
  })

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = originalNodeEnv
    if (originalDebugEnabled === undefined) delete process.env.SHENNIAN_TEST_LOGIN_ENABLED
    else process.env.SHENNIAN_TEST_LOGIN_ENABLED = originalDebugEnabled
  })

  it('does not issue a debug challenge without an explicitly configured phone', async () => {
    vi.stubEnv('SHENNIAN_TEST_LOGIN_PHONE', '')
    await expect(issueDebugPhoneLoginCode({ phone: debugPhone, remoteAddress: '127.0.0.1' })).rejects.toMatchObject({ statusCode: 403 })
    expect(mocks.redis.set).not.toHaveBeenCalled()
  })

  it('keeps independently issued challenges valid once when shared QA runs overlap', async () => {
    const first = await issueDebugPhoneLoginCode({
      phone: debugPhone,
      remoteAddress: '127.0.0.1',
    })
    const second = await issueDebugPhoneLoginCode({
      phone: debugPhone,
      remoteAddress: '127.0.0.1',
    })

    expect(first.code).toMatch(/^\d{6}$/)
    expect(second.code).toMatch(/^\d{6}$/)
    expect(first.code).not.toBe(second.code)
    await expect(verifyPhoneIdentity({ phone: debugPhone, code: first.code })).resolves.toMatchObject({
      id: 'debug-user',
    })
    await expect(verifyPhoneIdentity({ phone: debugPhone, code: second.code })).resolves.toMatchObject({
      id: 'debug-user',
    })
    await expect(
      verifyPhoneIdentity({ phone: debugPhone, code: first.code }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('atomically consumes a matching normal challenge without deleting it on a wrong guess', async () => {
    const phone = '+8613900000000'
    mocks.values.set(`sms:code:${phone}`, '246810')
    mocks.findUnique.mockResolvedValue({ id: 'normal-user', phone, name: 'Existing User' })

    await expect(
      verifyPhoneIdentity({ phone, code: '135790' }),
    ).rejects.toMatchObject({ statusCode: 400 })
    await expect(verifyPhoneIdentity({ phone, code: '246810' })).resolves.toMatchObject({
      id: 'normal-user',
    })
    await expect(
      verifyPhoneIdentity({ phone, code: '246810' }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('keeps a valid code available when scoped access rejects the user before consumption', async () => {
    const phone = '+8613900000001'
    mocks.values.set(`sms:code:${phone}`, '246810')
    mocks.findUnique.mockResolvedValue({ id: 'normal-user', phone, name: 'Existing User' })
    const deny = vi.fn(async () => { throw new Error('room_membership_required') })

    await expect(verifyPhoneIdentity({ phone, code: '246810' }, deny)).rejects.toThrow('room_membership_required')
    expect(deny).toHaveBeenCalledWith('normal-user')
    expect(mocks.values.get(`sms:code:${phone}`)).toBe('246810')
    await expect(verifyPhoneIdentity({ phone, code: '246810' })).resolves.toMatchObject({ id: 'normal-user' })
  })

  it('does not accept a debug challenge after the production test-login switch is disabled', async () => {
    process.env.NODE_ENV = 'production'
    process.env.SHENNIAN_TEST_LOGIN_ENABLED = '1'
    const challenge = await issueDebugPhoneLoginCode({
      phone: debugPhone,
      remoteAddress: '127.0.0.1',
    })

    delete process.env.SHENNIAN_TEST_LOGIN_ENABLED
    await expect(
      verifyPhoneIdentity({ phone: debugPhone, code: challenge.code }),
    ).rejects.toMatchObject({ statusCode: 400 })

    process.env.SHENNIAN_TEST_LOGIN_ENABLED = '1'
    await expect(
      verifyPhoneIdentity({ phone: debugPhone, code: challenge.code }),
    ).resolves.toMatchObject({ id: 'debug-user' })
  })
})

afterEach(() => vi.unstubAllEnvs())
