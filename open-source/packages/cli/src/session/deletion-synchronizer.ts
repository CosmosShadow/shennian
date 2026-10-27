// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/session-manager-core.test.ts

import crypto from 'node:crypto'
import {
  SESSION_SYNC_DATA_EPOCH,
  SESSION_SYNC_PROTOCOL_VERSION,
  type SessionDeletionCommand,
  type SessionDeletionsSyncResponse,
} from '@shennian/wire'
import type { CliRelayClient } from '../relay/client.js'
import { assertPersonalSyncIdentity } from '../personal-sync/epoch.js'
import { getDaemonInstallationId } from './store.js'
import { readDeletionSyncRevision, writeDeletionSyncRevision } from './deletion-sync-state.js'
import {
  assertDeletionSyncRunnable,
  clearDeletionSyncFailure,
  DeletionSyncRetryWaitError,
  DeletionSyncTerminalError,
  recordDeletionSyncFailure,
} from './deletion-sync-state.js'
import { validateDeletionSyncResponse } from './deletion-sync-validation.js'

export class SessionDeletionSynchronizer {
  constructor(
    private readonly client: CliRelayClient,
    private readonly applyDeletion: (deletion: SessionDeletionCommand) => Promise<void>,
  ) {}

  async synchronize(): Promise<void> {
    assertDeletionSyncRunnable()
    try {
      await this.synchronizeOnce()
      clearDeletionSyncFailure()
    } catch (error) {
      if (
        error instanceof DeletionSyncRetryWaitError ||
        error instanceof DeletionSyncTerminalError
      ) {
        throw error
      }
      const message = error instanceof Error ? error.message : String(error)
      const code =
        /offline|not connected|disconnect|timed out|timeout|temporar|unavailable|ECONN|ENOTFOUND|EIO|EBUSY/i.test(
          message,
        )
          ? 'transport_unavailable'
          : /invalid (?:deletion sync|session deletion)|deletion revision gap/i.test(message)
            ? 'invalid_deletion_sync_response'
            : 'deletion_sync_failed'
      console.warn('[session.deletions] retrying failed synchronization', { code })
      recordDeletionSyncFailure({ code, retryable: true })
      throw error
    }
  }

  private async synchronizeOnce(): Promise<void> {
    const daemonInstallationId = getDaemonInstallationId()
    const afterRevision = readDeletionSyncRevision()
    const response = await this.client.sendReq({
      type: 'req',
      id: `session-deletions-sync-${crypto.randomUUID()}`,
      method: 'session.deletions.sync',
      params: {
        protocolVersion: SESSION_SYNC_PROTOCOL_VERSION,
        dataEpoch: SESSION_SYNC_DATA_EPOCH,
        daemonInstallationId,
        afterRevision,
      },
    })
    if (!response.ok) {
      const rejection = response.rejection
      if (rejection) {
        recordDeletionSyncFailure({
          code: rejection.code,
          retryable: rejection.retryable && rejection.requiredAction === 'retry',
        })
        throw new Error(rejection.code)
      }
      recordDeletionSyncFailure({ code: 'unstructured_rejection', retryable: true })
      throw new Error(response.error ?? 'unstructured_rejection')
    }
    const payload = response.payload as SessionDeletionsSyncResponse
    assertPersonalSyncIdentity(payload)
    validateDeletionSyncResponse(payload, afterRevision)
    let appliedRevision = payload.baselineRevision
    if (appliedRevision > afterRevision) writeDeletionSyncRevision(appliedRevision)
    for (const deletion of payload.deletions) {
      if (deletion.deletionRevision <= appliedRevision) continue
      await this.applyDeletion(deletion)
      appliedRevision = deletion.deletionRevision
      writeDeletionSyncRevision(appliedRevision)
    }
    if (appliedRevision !== payload.latestRevision) {
      throw new Error(
        `deletion revision gap: applied ${appliedRevision}, latest ${payload.latestRevision}`,
      )
    }
    if (appliedRevision === 0) return
    const ack = await this.client.sendReq({
      type: 'req',
      id: `session-deletions-ack-${crypto.randomUUID()}`,
      method: 'session.deletions.ack',
      params: {
        protocolVersion: SESSION_SYNC_PROTOCOL_VERSION,
        dataEpoch: SESSION_SYNC_DATA_EPOCH,
        daemonInstallationId,
        deletionRevision: appliedRevision,
      },
    })
    if (!ack.ok) throw new Error(ack.error ?? 'session deletion acknowledgement failed')
  }
}
