// @covers open-source/packages/server/src/services/review-account-policy.ts
// @covers open-source/packages/server/src/services/auth-session.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  get: vi.fn(), set: vi.fn(), del: vi.fn(), exists: vi.fn(), eval: vi.fn(),
  findUnique: vi.fn(), sendSms: vi.fn(), captcha: vi.fn(), grantTrial: vi.fn(),
}))
vi.mock('../lib/prisma.js', () => ({ prisma: { user: { findUnique: mocks.findUnique } } }))
vi.mock('../lib/redis.js', () => ({ redis: { get: mocks.get, set: mocks.set, del: mocks.del, exists: mocks.exists, eval: mocks.eval } }))
vi.mock('../relay/connections.js', () => ({ connections: {} }))
vi.mock('../services/sms.js', () => ({ sendSmsCode: mocks.sendSms }))
vi.mock('../services/captcha.js', () => ({ verifyTencentCaptcha: mocks.captcha }))
vi.mock('../services/plan-access.js', () => ({ grantInitialProTrial: mocks.grantTrial }))
import { sendPhoneLoginCode, verifyPhoneIdentity } from '../services/auth-session.js'

const personalPhone = '+8619900000003'
describe('personal phone excluded from review login', () => {
  beforeEach(() => {
    vi.stubEnv('SHENNIAN_REVIEW_ACCOUNT_PHONES', '+8619900000002')
    vi.stubEnv('SHENNIAN_REVIEW_LOGIN_CODE', '654321')
    vi.resetAllMocks()
    mocks.exists.mockResolvedValue(0)
    mocks.eval.mockImplementation(
      async (_script: string, _keyCount: number, key: string, expected: string) =>
        (await mocks.get(key)) === expected ? 1 : 0,
    )
    mocks.captcha.mockResolvedValue({ ok: true })
    mocks.sendSms.mockResolvedValue({ debug: false })
  })
  it('sends a real SMS challenge and validates that delivered challenge', async () => {
    expect(await sendPhoneLoginCode({ phone: personalPhone, ip: '127.0.0.1' })).toEqual({})
    expect(mocks.captcha).toHaveBeenCalled()
    expect(mocks.sendSms).toHaveBeenCalledWith(personalPhone, expect.stringMatching(/^\d{6}$/))
    const deliveredCode = mocks.sendSms.mock.calls[0][1]
    expect(mocks.set).toHaveBeenCalledWith(`sms:code:${personalPhone}`, deliveredCode, 'EX', 300)
    expect(mocks.set).toHaveBeenCalledWith(`sms:limit:${personalPhone}`, '1', 'EX', 60)
    mocks.get.mockResolvedValue(deliveredCode)
    mocks.findUnique.mockResolvedValue({ id: 'personal-user', phone: personalPhone, name: 'Existing User' })
    expect(await verifyPhoneIdentity({ phone: personalPhone, code: deliveredCode })).toMatchObject({ id: 'personal-user' })
    expect(mocks.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      `sms:code:${personalPhone}`,
      deliveredCode,
    )
  })
  it('does not falsely report success if the SMS provider fails', async () => {
    mocks.sendSms.mockRejectedValue(new Error('provider unavailable'))
    await expect(sendPhoneLoginCode({ phone: personalPhone, ip: '127.0.0.1' })).rejects.toMatchObject({ statusCode: 502 })
    expect(mocks.set).not.toHaveBeenCalled()
  })
  it('requires an actual stored challenge for the personal phone', async () => {
    mocks.get.mockResolvedValue(null)
    await expect(verifyPhoneIdentity({ phone: personalPhone, code: '000000' })).rejects.toMatchObject({ statusCode: 400 })
    expect(mocks.findUnique).not.toHaveBeenCalled()
  })
  it('does not allow a source-known fixed review code when configuration is absent', async () => {
    vi.stubEnv('SHENNIAN_REVIEW_LOGIN_CODE', '')
    mocks.get.mockResolvedValue(null)
    await expect(verifyPhoneIdentity({ phone: '+8619900000002', code: '654321' })).rejects.toMatchObject({ statusCode: 400 })
    await sendPhoneLoginCode({ phone: '+8619900000002', ip: '127.0.0.1' })
    expect(mocks.sendSms).toHaveBeenCalled()
  })

  it('keeps the designated review phone on the non-SMS review flow', async () => {
    await sendPhoneLoginCode({ phone: '+8619900000002', ip: '127.0.0.1' })
    expect(mocks.sendSms).not.toHaveBeenCalled()
    expect(mocks.captcha).not.toHaveBeenCalled()
  })
})

afterEach(() => vi.unstubAllEnvs())
