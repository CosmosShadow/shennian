// @arch docs/architecture/local-apps.md
// @test src/__tests__/interactive-content-session.test.ts
/** Only controlled categories leave this boundary; never render raw API errors. */
export function localAppErrorKey(error: unknown): string {
  const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : undefined
  if (status === 401) return 'local_session_expired'
  if (status === 403) return 'local_access_denied'
  if (status === 404) return 'local_not_ready'
  if (status === 410) return 'local_reopen'
  let code = error instanceof Error ? error.message : ''
  if (code.length <= 4096 && code.startsWith('{')) {
    try { const parsed = JSON.parse(code); code = typeof parsed.error === 'string' ? parsed.error : '' } catch { code = '' }
  }
  switch (code) {
    case 'local_machine_unavailable': return 'local_computer_offline'
    case 'local_client_upgrade_required': return 'local_update_client'
    case 'local_app_unavailable': return 'local_app_missing'
    case 'service_timeout': return 'local_service_slow'
    case 'service_unavailable': case 'local_service_unavailable': return 'local_service_stopped'
    case 'service_busy': return 'local_service_busy'
    case 'local_runtime_expired': return 'local_reopen'
    default: return 'local_unavailable'
  }
}
