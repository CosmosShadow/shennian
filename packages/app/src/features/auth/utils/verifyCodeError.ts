// @arch docs/architecture/app/modular-features.md#登录-feature
// @test packages/app/src/__tests__/auth-providers.test.ts

import { ApiError } from '@shennian/shared/api'

export function getVerifyCodeErrorTranslationKey(error: unknown): string {
  const brokerCode = getDesktopBrokerErrorCode(error)
  if (brokerCode === 'CREDENTIAL_COMMIT_FAILED') {
    return 'desktop_login_credential_commit_failed'
  }
  if (brokerCode === 'RATE_LIMITED') return 'error_send_code_rate_limit'
  if (error instanceof ApiError) {
    try {
      const payload = JSON.parse(error.message) as { error?: string }
      switch (payload.error) {
        case 'room_membership_required':
        case 'room_join_unavailable':
          return 'room_access_invite_required_body'
        case 'review_account_machine_access_forbidden':
          return 'device_auth_review_forbidden'
        case 'login_intent_expired':
          return 'device_auth_expired'
        case 'login_intent_not_found':
          return 'device_auth_invalid'
        case 'login_intent_unavailable':
          return 'device_auth_unavailable'
        case 'invite_required':
          return 'error_invite_required'
        case 'invite_invalid':
          return 'error_invite_invalid'
        case 'invite_expired':
          return 'error_invite_expired'
        case 'invite_exhausted':
          return 'error_invite_exhausted'
        case 'join_message_required':
          return 'room_invite_message_required'
        case 'room_browser_session_limit_reached':
          return 'room_browser_session_limit_reached'
      }
    } catch {
      // Fall through to the generic verification copy.
    }
  }
  return 'error_verify_code'
}

function getDesktopBrokerErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : null
}
