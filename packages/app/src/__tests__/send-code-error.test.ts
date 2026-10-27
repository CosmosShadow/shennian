import { ApiError } from '@shennian/shared'
import { describe, expect, it } from 'vitest'
import { getSendCodeErrorTranslationKey } from '../features/auth/utils/sendCodeError'

describe('send code error mapping', () => {
  it('maps rate limits and server failures to dedicated translations', () => {
    expect(getSendCodeErrorTranslationKey(new ApiError(429, 'Please wait 60s before resending')))
      .toBe('error_send_code_rate_limit')
    expect(getSendCodeErrorTranslationKey(new ApiError(502, 'SMS service unavailable')))
      .toBe('error_send_code_service_unavailable')
  })

  it('maps network and timeout failures to clearer messages', () => {
    expect(getSendCodeErrorTranslationKey(new TypeError('Network request failed')))
      .toBe('error_send_code_network')
    expect(getSendCodeErrorTranslationKey(new Error('The operation was aborted due to timeout')))
      .toBe('error_send_code_timeout')
  })

  it('falls back to the generic translation for unknown failures', () => {
    expect(getSendCodeErrorTranslationKey(new Error('Something odd happened')))
      .toBe('error_send_code')
  })
})
