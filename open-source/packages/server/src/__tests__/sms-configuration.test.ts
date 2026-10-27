// @covers open-source/packages/server/src/services/sms.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sendSmsCode } from '../services/sms.js'

afterEach(() => vi.unstubAllEnvs())

describe('SMS deployment configuration', () => {
  it('fails closed in production even when DEBUG is set and cloud keys are missing', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('DEBUG', 'true')
    vi.stubEnv('ALIYUN_ACCESS_KEY_ID', '')
    vi.stubEnv('ALIYUN_ACCESS_KEY_SECRET', '')
    await expect(sendSmsCode('+19999999999', '111222')).rejects.toThrow('SMS provider is not configured')
  })

  it('does not fall back to official SMS sign or template values', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('ALIYUN_ACCESS_KEY_ID', 'unit-id')
    vi.stubEnv('ALIYUN_ACCESS_KEY_SECRET', 'unit-secret')
    vi.stubEnv('ALIYUN_SMS_SIGN', '')
    vi.stubEnv('ALIYUN_SMS_TEMPLATE', '')
    await expect(sendSmsCode('+19999999999', '111222')).rejects.toThrow('SMS provider is not configured')
  })

  it('retains explicit local debug behavior without contacting a provider', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('DEBUG', 'true')
    await expect(sendSmsCode('+19999999999', '111222')).resolves.toEqual({ debug: true })
  })
})
