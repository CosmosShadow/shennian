// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/session-index-publisher.test.ts

import type { CliRelayClient } from '../relay/client.js'
import crypto from 'node:crypto'
import type { SessionTitleGenerateResponse } from '@shennian/wire'
import {
  acknowledgeSessionIndexUpdate,
  applyGeneratedSessionTitle,
  claimSessionTitleGenerationCandidates,
  deferSessionTitleGeneration,
  listPendingSessionIndexUpdates,
  listSessionRecords,
  purgeCanonicalSession,
  purgeSessionRecord,
  recordSessionIndexRejection,
} from './store.js'
import { recordPersonalSyncLocalMetric } from '../personal-sync/metrics.js'
import { SessionSyncRejectedError } from '../relay/client.js'
import { NativeSourceDeletionStore } from '../native-fusion/native-source-deletions.js'
import { getDaemonInstallationId } from '../personal-sync/identity.js'
import { purgeToolDetails } from './tool-detail-store.js'
import { purgeQueuedSessionData } from './queue.js'
import { getPersonalSyncIdentity } from '../personal-sync/epoch.js'

const inFlight = new WeakMap<object, Promise<void>>()
const rerunRequested = new WeakSet<object>()

export function publishPendingSessionIndexes(
  client: Pick<CliRelayClient, 'sendBufferedEvent' | 'sendReq'> & Partial<Pick<CliRelayClient, 'disconnect'>>,
): Promise<void> {
  const key = client as object
  const active = inFlight.get(key)
  if (active) {
    rerunRequested.add(key)
    return active
  }
  const work = run(client).finally(() => {
    if (inFlight.get(key) === work) inFlight.delete(key)
    if (rerunRequested.delete(key)) requestSessionIndexPublish(client)
  })
  inFlight.set(key, work)
  return work
}

async function run(
  client: Pick<CliRelayClient, 'sendBufferedEvent' | 'sendReq'> & Partial<Pick<CliRelayClient, 'disconnect'>>,
): Promise<void> {
  const pending = listPendingSessionIndexUpdates()
  const failures: unknown[] = []
  for (const update of pending) {
    try {
      const ack = await client.sendBufferedEvent({
        type: 'event',
        event: 'session.index.updated',
        id: `session-index-${update.daemonInstallationId}-${update.session.id}-${update.session.indexRevision}`,
        payload: update,
      }, 60_000)
      if (ack) validateIndexAck(update, ack)
      acknowledgeSessionIndexUpdate(update.session.id, update.session.indexRevision)
      recordPersonalSyncLocalMetric('indexAcknowledged')
    } catch (error) {
      // One stale/conflicting session must not head-of-line block every newer
      // session. Structured authority decisions are durable terminal states;
      // only actual transport/transient failures remain retryable.
      const disposition = applyIndexFailure(update, error, client)
      if (disposition === 'retry') failures.push(error)
      recordPersonalSyncLocalMetric('indexFailed')
      if (disposition === 'retry') recordPersonalSyncLocalMetric('indexDirtyRetained')
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, 'one or more session indexes failed')

  for (const candidate of claimSessionTitleGenerationCandidates()) {
    try {
      const response = await client.sendReq({
        type: 'req',
        id: `session-title-generate-${crypto.randomUUID()}`,
        method: 'session.title.generate',
        params: { ...getPersonalSyncIdentity(), ...candidate },
      }, 15_000)
      if (!response.ok) {
        deferAndScheduleTitleGeneration(client, candidate.sessionId)
        continue
      }
      const result = response.payload as SessionTitleGenerateResponse
      if (result?.generated && applyGeneratedSessionTitle(candidate.sessionId, result)) {
        rerunRequested.add(client as object)
      } else if (!result?.generated) {
        deferAndScheduleTitleGeneration(client, candidate.sessionId)
      }
    } catch (error) {
      deferAndScheduleTitleGeneration(client, candidate.sessionId)
      console.warn(
        `[session-title] generation attempt ended sessionId=${candidate.sessionId} requestId=${candidate.requestId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }
}

function deferAndScheduleTitleGeneration(
  client: Pick<CliRelayClient, 'sendBufferedEvent' | 'sendReq'> & Partial<Pick<CliRelayClient, 'disconnect'>>,
  sessionId: string,
): void {
  const nextAttemptAt = deferSessionTitleGeneration(sessionId)
  if (!nextAttemptAt) return
  const delayMs = Math.max(0, Date.parse(nextAttemptAt) - Date.now())
  const timer = setTimeout(() => requestSessionIndexPublish(client), delayMs)
  timer.unref?.()
}

function validateIndexAck(
  update: ReturnType<typeof listPendingSessionIndexUpdates>[number],
  ack: Awaited<ReturnType<CliRelayClient['sendBufferedEvent']>>,
): void {
  if (!ack) return
  const payload = ack.payload as Record<string, unknown> | undefined
  if (
    !payload
    || payload.daemonInstallationId !== update.daemonInstallationId
    || payload.dataEpoch !== update.dataEpoch
    || payload.sessionId !== update.session.id
    || payload.indexRevision !== update.session.indexRevision
  ) throw new Error('invalid session index acknowledgement identity')
}

function applyIndexFailure(
  update: ReturnType<typeof listPendingSessionIndexUpdates>[number],
  error: unknown,
  client: Partial<Pick<CliRelayClient, 'disconnect'>>,
): 'retry' | 'quarantined' | 'terminal' | 'purged' {
  const sessionId = update.session.id
  const indexRevision = update.session.indexRevision
  if (error instanceof SessionSyncRejectedError) {
    const { rejection } = error
    if (rejection.requiredAction === 'purge_session' && rejection.code === 'session_deleted') {
      const record = listSessionRecords().find((candidate) => candidate.sessionId === sessionId)
      const deletionRevision = Math.max(
        1,
        record?.deletionRevision ?? 0,
        rejection.authoritativeRevision ?? 0,
      )
      const tombstones = new NativeSourceDeletionStore({
        daemonInstallationId: getDaemonInstallationId(),
      })
      tombstones.recordSession({ sessionId, deletionRevision })
      if (record?.agentSessionId) {
        tombstones.record({
          sessionId,
          deletionRevision,
          agentType: record.agentType,
          sourceSessionKey: record.agentSessionId,
        })
      }
      purgeQueuedSessionData(sessionId)
      purgeToolDetails(sessionId)
      purgeCanonicalSession(sessionId)
      purgeSessionRecord(sessionId)
      return 'purged'
    }
    if (rejection.retryable && rejection.requiredAction === 'retry') {
      recordPersonalSyncLocalMetric('transientRetries')
      return recordSessionIndexRejection({
        sessionId, indexRevision, code: rejection.code, disposition: 'retry',
      })
    }
    const quarantine = rejection.requiredAction === 'quarantine_record'
      || rejection.code === 'room_authority_conflict'
      || rejection.code === 'invalid_payload'
      || rejection.code === 'invalid_identity'
    const disposition = recordSessionIndexRejection({
      sessionId,
      indexRevision,
      code: rejection.code,
      disposition: quarantine ? 'quarantined' : 'terminal',
    })
    recordPersonalSyncLocalMetric(
      disposition === 'quarantined' ? 'quarantinedRecords' : 'permanentStops',
    )
    if (
      rejection.requiredAction === 'refresh_machine_ownership'
      || rejection.requiredAction === 'upgrade_client'
      || rejection.requiredAction === 'reset_epoch'
      || rejection.requiredAction === 'stop'
    ) client.disconnect?.()
    return disposition
  }

  const message = error instanceof Error ? error.message : String(error)
  const transient = /offline|not connected|disconnect|timed out|timeout|temporar|unavailable|ECONN|ENOTFOUND/i.test(message)
  const disposition = recordSessionIndexRejection({
    sessionId,
    indexRevision,
    code: transient ? 'transport_unavailable' : 'unstructured_rejection',
    disposition: transient ? 'retry' : 'terminal',
  })
  recordPersonalSyncLocalMetric(transient ? 'transientRetries' : 'permanentStops')
  return disposition
}

export function requestSessionIndexPublish(
  client: Pick<CliRelayClient, 'sendBufferedEvent' | 'sendReq'> & Partial<Pick<CliRelayClient, 'disconnect'>>,
): void {
  void publishPendingSessionIndexes(client).catch((error) => {
    console.error('[session-index] sync failed; dirty revisions retained for retry', error)
  })
}
