// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/conversation-export.test.ts
// Offline-only migration candidate. No daemon handler or network route imports this module.

import { createHash } from 'node:crypto'
import type { CanonicalMutation, CanonicalSessionStore } from './canonical-store.js'

export type ExportPhase = 'snapshot' | 'catchup'
export type ExportCursor = {
  daemonInstallationId: string
  sessionId: string
  snapshotRevision: number
  afterRevision: number
  phase: ExportPhase
  auditHash: string
}
export type ExportItem = {
  revision: number
  sequence: number
  mutationId: string
  contentHash: string
  exportId: string
  mutationHash: string
  mutation: CanonicalMutation
}
export type ExportPage = {
  cursor: ExportCursor
  targetRevision: number
  items: ExportItem[]
  nextCursor: ExportCursor
  pageHash: string
  batch: { sessionId: string; fromRevision: number; mutations: CanonicalMutation[] }
}
export type CutoverFence = {
  daemonInstallationId: string
  sessionId: string
  revision: number
  lastMutationHash: string | null
}

const digest = (value: string): string => createHash('sha256').update(value).digest('hex')
export const CONVERSATION_EXPORT_GENESIS_HASH = '0'.repeat(64)
const positiveLimit = (limit: number): number => {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
    throw new Error('export page limit must be between 1 and 50')
  }
  return limit
}

export function beginConversationExport(
  store: Pick<CanonicalSessionStore, 'getManifest' | 'daemonInstallationId'>,
  sessionId: string,
): ExportCursor {
  if (!sessionId) throw new Error('sessionId is required')
  const manifest = store.getManifest(sessionId)
  if (!manifest) throw new Error('canonical session is unavailable')
  if (manifest.daemonInstallationId !== store.daemonInstallationId) {
    throw new Error('canonical daemon identity changed')
  }
  return {
    daemonInstallationId: store.daemonInstallationId,
    sessionId,
    snapshotRevision: manifest.bodyRevision,
    afterRevision: 0,
    phase: 'snapshot',
    auditHash: CONVERSATION_EXPORT_GENESIS_HASH,
  }
}

/** A snapshot is the complete ordered mutation log through a fixed revision.
 * This retains upserts, tombstones, delivery states and native tool events.
 * The caller persists/acknowledges nextCursor only after the destination
 * atomically verifies and commits the entire page.
 */
export function readConversationExportPage(
  store: Pick<CanonicalSessionStore, 'getManifest' | 'readDeltas' | 'daemonInstallationId'>,
  cursor: ExportCursor,
  limit: number,
): ExportPage {
  positiveLimit(limit)
  if (!cursor.sessionId || cursor.daemonInstallationId !== store.daemonInstallationId
    || !Number.isSafeInteger(cursor.snapshotRevision) || cursor.snapshotRevision < 0
    || !Number.isSafeInteger(cursor.afterRevision) || cursor.afterRevision < 0
    || !/^[a-f0-9]{64}$/.test(cursor.auditHash)
    || (cursor.phase === 'snapshot' && cursor.afterRevision > cursor.snapshotRevision)
    || (cursor.phase !== 'snapshot' && cursor.phase !== 'catchup')) {
    throw new Error('invalid export cursor')
  }
  const manifest = store.getManifest(cursor.sessionId)
  if (!manifest || manifest.daemonInstallationId !== cursor.daemonInstallationId
    || manifest.bodyRevision < cursor.snapshotRevision
    || manifest.bodyRevision < cursor.afterRevision) {
    throw new Error('canonical source changed or became unavailable')
  }
  const targetRevision = cursor.phase === 'snapshot'
    ? cursor.snapshotRevision : manifest.bodyRevision
  const mutations = cursor.afterRevision < targetRevision
    ? store.readDeltas(cursor.sessionId, cursor.afterRevision, limit)
      .filter((mutation) => mutation.revision <= targetRevision)
    : []
  if (cursor.afterRevision < targetRevision && mutations.length === 0) {
    throw new Error('canonical export gap')
  }
  let expectedRevision = cursor.afterRevision + 1
  let auditHash = cursor.auditHash
  const items = mutations.map((mutation): ExportItem => {
    if (mutation.sessionId !== cursor.sessionId
      || mutation.daemonInstallationId !== cursor.daemonInstallationId
      || mutation.revision !== expectedRevision++
      || !Number.isSafeInteger(mutation.sequence) || mutation.sequence < 1
      || !mutation.mutationId || !mutation.contentHash) {
      throw new Error('canonical export identity or revision mismatch')
    }
    const expectedContentHash = digest(JSON.stringify({
      mutation: mutation.mutation,
      message: mutation.message ?? null,
      deliveryState: mutation.deliveryState ?? null,
    }))
    if (mutation.contentHash !== expectedContentHash) {
      throw new Error('canonical export content hash mismatch')
    }
    auditHash = digest(`${auditHash}\0${mutation.mutationId}\0${mutation.contentHash}`)
    return {
      revision: mutation.revision,
      sequence: mutation.sequence,
      mutationId: mutation.mutationId,
      contentHash: mutation.contentHash,
      exportId: digest(JSON.stringify([
        cursor.daemonInstallationId, cursor.sessionId, mutation.revision,
      ])),
      mutationHash: digest(JSON.stringify(mutation)),
      mutation,
    }
  })
  const afterRevision = items.at(-1)?.revision ?? cursor.afterRevision
  const nextCursor: ExportCursor = {
    ...cursor,
    afterRevision,
    auditHash,
    phase: cursor.phase === 'snapshot' && afterRevision === cursor.snapshotRevision
      ? 'catchup' : cursor.phase,
  }
  return {
    cursor, targetRevision, items, nextCursor,
    pageHash: digest(JSON.stringify(items.map(({ exportId, mutationHash }) => [exportId, mutationHash]))),
    batch: { sessionId: cursor.sessionId, fromRevision: cursor.afterRevision, mutations },
  }
}

/** Must be called only after writers for this Session are actually fenced.
 * A boolean alone is never a locking mechanism; the caller owns that fence.
 */
export function assertConversationCutoverFence(
  store: Pick<CanonicalSessionStore, 'getManifest' | 'readDeltas' | 'daemonInstallationId'>,
  cursor: ExportCursor,
  destinationAckRevision: number,
  writersFenced: boolean,
): CutoverFence {
  if (!writersFenced || cursor.phase !== 'catchup'
    || destinationAckRevision !== cursor.afterRevision) {
    throw new Error('cutover requires a fenced writer and acknowledged catchup')
  }
  const manifest = store.getManifest(cursor.sessionId)
  if (!manifest || manifest.daemonInstallationId !== cursor.daemonInstallationId
    || manifest.bodyRevision !== cursor.afterRevision) {
    throw new Error('cutover revision changed; resume catchup')
  }
  const last = cursor.afterRevision > 0
    ? store.readDeltas(cursor.sessionId, cursor.afterRevision - 1, 1)[0] : null
  if (cursor.afterRevision > 0 && (!last || last.revision !== cursor.afterRevision)) {
    throw new Error('cutover tail is unavailable')
  }
  return {
    daemonInstallationId: cursor.daemonInstallationId,
    sessionId: cursor.sessionId,
    revision: cursor.afterRevision,
    lastMutationHash: last ? digest(JSON.stringify(last)) : null,
  }
}
