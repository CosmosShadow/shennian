import { ApiError } from '@shennian/shared/api'

export const SEND_CODE_TIMEOUT_MS = 8000

export type SendCodeErrorTranslationKey =
  | 'error_send_code'
  | 'error_send_code_network'
  | 'error_send_code_timeout'
  | 'error_send_code_rate_limit'
  | 'error_send_code_service_unavailable'

export function createRequestTimeoutSignal(timeoutMs = SEND_CODE_TIMEOUT_MS): AbortSignal {
  const controller = new AbortController()
  setTimeout(() => controller.abort(new Error('Request timeout')), timeoutMs)
  return controller.signal
}

export function getSendCodeErrorTranslationKey(error: unknown): SendCodeErrorTranslationKey {
  if (error instanceof ApiError) {
    if (error.status === 429) return 'error_send_code_rate_limit'
    if (error.status >= 500) return 'error_send_code_service_unavailable'
    return 'error_send_code'
  }

  if (isAbortError(error)) {
    return 'error_send_code_timeout'
  }

  if (isNetworkError(error)) {
    return 'error_send_code_network'
  }

  return 'error_send_code'
}

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return error.name === 'AbortError' || /aborted|timeout/i.test(error.message)
}

function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return /network request failed|network error|failed to fetch|load failed|offline/i.test(error.message)
}
