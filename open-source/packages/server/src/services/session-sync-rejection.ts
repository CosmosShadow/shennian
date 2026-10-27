// @arch open-source/docs/server-runtime.md
// @test src/__tests__/session-sync-rejection.test.ts

import {
  SESSION_SYNC_DATA_EPOCH,
  type SessionSyncErrorCode,
  type SessionSyncRejection,
  type SessionSyncRequiredAction,
} from '@shennian/wire'

const DEFAULT_ACTIONS: Record<SessionSyncErrorCode, {
  retryable: boolean
  requiredAction: SessionSyncRequiredAction
}> = {
  upgrade_required: { retryable: false, requiredAction: 'upgrade_client' },
  epoch_mismatch: { retryable: false, requiredAction: 'reset_epoch' },
  session_deleted: { retryable: false, requiredAction: 'purge_session' },
  ownership_transferred: { retryable: false, requiredAction: 'refresh_machine_ownership' },
  token_revoked: { retryable: false, requiredAction: 'refresh_machine_ownership' },
  room_authority_conflict: { retryable: false, requiredAction: 'quarantine_record' },
  invalid_payload: { retryable: false, requiredAction: 'quarantine_record' },
  invalid_identity: { retryable: false, requiredAction: 'quarantine_record' },
  revision_gap: { retryable: false, requiredAction: 'stop' },
  snapshot_compacted: { retryable: false, requiredAction: 'stop' },
  machine_offline: { retryable: true, requiredAction: 'retry' },
  history_unavailable: { retryable: true, requiredAction: 'retry' },
  subscription_not_found: { retryable: false, requiredAction: 'stop' },
  subscription_limit_exceeded: { retryable: true, requiredAction: 'retry' },
  response_too_large: { retryable: false, requiredAction: 'stop' },
  temporary_unavailable: { retryable: true, requiredAction: 'retry' },
}

export class SessionSyncRejectionError extends Error {
  readonly rejection: SessionSyncRejection

  constructor(
    code: SessionSyncErrorCode,
    details: Partial<Omit<SessionSyncRejection, 'code' | 'retryable' | 'requiredAction'>> & {
      retryable?: boolean
      requiredAction?: SessionSyncRequiredAction
    } = {},
  ) {
    const defaults = DEFAULT_ACTIONS[code]
    super(details.message ?? code)
    this.name = 'SessionSyncRejectionError'
    this.rejection = {
      code,
      retryable: details.retryable ?? defaults.retryable,
      requiredAction: details.requiredAction ?? defaults.requiredAction,
      ...(details.authoritativeEpoch !== undefined
        ? { authoritativeEpoch: details.authoritativeEpoch }
        : {}),
      ...(details.authoritativeRevision !== undefined
        ? { authoritativeRevision: details.authoritativeRevision }
        : {}),
      ...(details.message ? { message: details.message } : {}),
    }
  }
}

export function rejectSessionSync(
  code: SessionSyncErrorCode,
  details: ConstructorParameters<typeof SessionSyncRejectionError>[1] = {},
): never {
  throw new SessionSyncRejectionError(code, details)
}

export function normalizeSessionSyncRejection(error: unknown): SessionSyncRejection {
  if (error instanceof SessionSyncRejectionError) return error.rejection
  const message = error instanceof Error ? error.message : String(error)
  if (message in DEFAULT_ACTIONS) {
    return new SessionSyncRejectionError(message as SessionSyncErrorCode).rejection
  }
  if (/room|Room/.test(message) && /conflict|authority|bound/.test(message)) {
    return new SessionSyncRejectionError('room_authority_conflict').rejection
  }
  if (/ownership|not authorized|forbidden|publisher|machine_owner_required/.test(message)) {
    return new SessionSyncRejectionError('ownership_transferred').rejection
  }
  if (/epoch/.test(message)) {
    return new SessionSyncRejectionError('epoch_mismatch', {
      authoritativeEpoch: SESSION_SYNC_DATA_EPOCH,
    }).rejection
  }
  if (/upgrade|required protocol|unsupported session sync protocol/.test(message)) {
    return new SessionSyncRejectionError('upgrade_required', {
      authoritativeEpoch: SESSION_SYNC_DATA_EPOCH,
    }).rejection
  }
  if (/invalid|forged|missing_user_boundary|conflict|moved backwards|cannot carry|requires|future_deletion_revision/.test(message)) {
    return new SessionSyncRejectionError('invalid_payload', {
      authoritativeEpoch: SESSION_SYNC_DATA_EPOCH,
    }).rejection
  }
  return {
    code: 'temporary_unavailable',
    retryable: true,
    requiredAction: 'retry',
    authoritativeEpoch: SESSION_SYNC_DATA_EPOCH,
  }
}
