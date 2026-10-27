// @covers open-source/packages/wire/src/session-sync.ts

import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  SESSION_SYNC_PROTOCOL_VERSION,
  SESSION_SYNC_DATA_EPOCH,
  SESSION_SYNC_REQUIRED_CAPABILITIES,
  SESSION_SYNC_ADDITIVE_CAPABILITIES,
  SESSION_SYNC_ADVERTISED_CAPABILITIES,
  SESSION_SYNC_REQUIRED_ACTIONS,
  SESSION_SYNC_RELEASE_GATE,
  PERSONAL_SYNC_FAILURE_FIXTURES,
  SESSION_HISTORY_LIMITS,
  SESSION_TOOL_DETAIL_LIMITS,
  getMissingSessionSyncCapabilities,
  hasRequiredSessionSyncCapabilities,
  type PersonalAttachmentReference,
  type SessionBodyDeltaEvent,
  type SessionBodyReplicaDeltaEvent,
  type SessionBodyReplicaErrorEvent,
  type SessionBodyReplicaSubscribeParams,
  type SessionBodyReplicaSubscribeResponse,
  type SessionDurableSendAck,
  type SessionHistoryOpenParams,
  type SessionHistorySyncParams,
  type SessionHistorySyncPage,
  type SessionHistorySnapshot,
  type SessionIndexUpdate,
  type SessionDeletionCommand,
  type NativeCleanupPolicy,
  type SessionDeletionsAckParams,
  type SessionDeletionsSyncParams,
  type SessionMessageStatusResponse,
  type SessionSyncCapability,
  type SessionToolDetailRequest,
  type SessionToolDetailResponse,
  type VoiceSessionBodyWindowParams,
} from '../index.ts'

describe('personal Session sync v2 contract', () => {
  it('freezes one protocol version and the complete hard-cutover capability set', () => {
    expect(SESSION_SYNC_PROTOCOL_VERSION).toBe(2)
    expect(SESSION_SYNC_DATA_EPOCH).toBe(2)
    expect(SESSION_SYNC_RELEASE_GATE.minCliVersion).toBe('0.3.65')
    expect(SESSION_SYNC_REQUIRED_CAPABILITIES).toEqual([
      'session_index_v1',
      'session_body_revision_v1',
      'session_history_subscription_v1',
      'local_canonical_v1',
      'session_title_authority_v1',
      'session_title_seed_v1',
      'session_tool_detail_v1',
      'voice_session_body_relay_v1',
      'native_source_tombstone_v1',
      'session_durable_send_v1',
      'daemon_installation_identity_v1',
      'session_user_boundary_v1',
      'session_terminal_outbox_v1',
      'session_list_preview_v1',
      'session_attention_v1',
      'session_data_epoch_v2',
      'session_structured_rejection_v2',
      'machine_personal_authority_v2',
    ])
    expect(SESSION_SYNC_REQUIRED_ACTIONS).toEqual([
      'retry', 'reset_epoch', 'purge_session', 'quarantine_record',
      'refresh_machine_ownership', 'upgrade_client', 'stop',
    ])
    expect(new Set(SESSION_SYNC_REQUIRED_CAPABILITIES).size).toBe(
      SESSION_SYNC_REQUIRED_CAPABILITIES.length,
    )
    expectTypeOf<(typeof SESSION_SYNC_REQUIRED_CAPABILITIES)[number]>().toMatchTypeOf<SessionSyncCapability>()
    expect(hasRequiredSessionSyncCapabilities(SESSION_SYNC_REQUIRED_CAPABILITIES)).toBe(true)
    expect(getMissingSessionSyncCapabilities(['session_index_v1'])).toEqual(
      SESSION_SYNC_REQUIRED_CAPABILITIES.slice(1),
    )
    expect(hasRequiredSessionSyncCapabilities(undefined)).toBe(false)
    expect(SESSION_SYNC_ADDITIVE_CAPABILITIES).toEqual([
      'session_body_replica_v1',
      'session_body_replica_stream_v1',
      'active_run_recovery_v1',
      'external_updater_v1',
      'room_message_delivery_v1',
    ])
    expect(SESSION_SYNC_ADVERTISED_CAPABILITIES).toEqual([
      ...SESSION_SYNC_REQUIRED_CAPABILITIES,
      'session_body_replica_v1',
      'session_body_replica_stream_v1',
      'active_run_recovery_v1',
      'external_updater_v1',
      'room_message_delivery_v1',
    ])
    expect(hasRequiredSessionSyncCapabilities(SESSION_SYNC_REQUIRED_CAPABILITIES)).toBe(true)
  })

  it('freezes bounded snapshot, delta and subscription limits', () => {
    expect(SESSION_HISTORY_LIMITS.defaultSnapshotMessages).toBeLessThanOrEqual(
      SESSION_HISTORY_LIMITS.maxSnapshotMessages,
    )
    expect(SESSION_HISTORY_LIMITS.defaultPageMessages).toBeLessThanOrEqual(
      SESSION_HISTORY_LIMITS.maxPageMessages,
    )
    expect(SESSION_HISTORY_LIMITS.maxSubscriptionsPerClient).toBeGreaterThan(0)
    expect(SESSION_HISTORY_LIMITS.maxSubscriptionsPerSession).toBeGreaterThan(0)
    expect(SESSION_HISTORY_LIMITS.maxReplicaStreamsPerDaemon).toBeGreaterThan(0)
    expect(SESSION_HISTORY_LIMITS.maxReplicaPageBytes).toBeGreaterThan(
      SESSION_HISTORY_LIMITS.maxMutationBytes,
    )
  })

  it('freezes privacy-safe fixtures for every observed hard-cut failure', () => {
    expect(PERSONAL_SYNC_FAILURE_FIXTURES.map((fixture) => fixture.id)).toEqual([
      'legacy_index_replay_after_server_reset',
      'personal_index_targets_room_session',
      'history_response_not_durably_applied',
      'native_path_move_replays_attention',
    ])
    expect(JSON.stringify(PERSONAL_SYNC_FAILURE_FIXTURES)).not.toMatch(/message|content|text|attachmentPath/)
  })

  it('requires revisioned history and durable-send identities', () => {
    expectTypeOf<SessionHistoryOpenParams>().toHaveProperty('subscriptionId')
    expectTypeOf<SessionHistorySyncParams>().toHaveProperty('afterRevision')
    expectTypeOf<SessionHistorySyncPage>().toHaveProperty('targetRevision')
    expectTypeOf<SessionHistorySnapshot>().toHaveProperty('snapshotRevision')
    expectTypeOf<SessionBodyDeltaEvent>().toHaveProperty('fromRevision')
    expectTypeOf<SessionBodyDeltaEvent>().toHaveProperty('toRevision')
    expectTypeOf<SessionBodyReplicaSubscribeParams>().toHaveProperty('generation')
    expectTypeOf<SessionBodyReplicaSubscribeResponse>().toHaveProperty('highWatermarks')
    expectTypeOf<SessionBodyReplicaDeltaEvent>().toHaveProperty('batches')
    expectTypeOf<SessionBodyReplicaErrorEvent>().toHaveProperty('rejection')
    expectTypeOf<SessionDurableSendAck>().toHaveProperty('clientMessageId')
    expectTypeOf<SessionDurableSendAck>().toHaveProperty('messageId')
    expectTypeOf<SessionDurableSendAck>().toHaveProperty('bodyRevision')
    expectTypeOf<SessionMessageStatusResponse>().toMatchTypeOf<
      | { state: 'not_found'; sessionId: string; clientMessageId: string }
      | { state: string; sessionId: string; clientMessageId: string }
    >()
  })

  it('keeps personal attachment references byte-free', () => {
    expectTypeOf<PersonalAttachmentReference>().toHaveProperty('path')
    expectTypeOf<PersonalAttachmentReference>().toHaveProperty('byteSize')
    expectTypeOf<PersonalAttachmentReference>().toHaveProperty('sha256')
    expectTypeOf<PersonalAttachmentReference>().not.toHaveProperty('data')
    expectTypeOf<PersonalAttachmentReference>().not.toHaveProperty('previewData')
  })

  it('requires index authority and monotonic revision fields', () => {
    expectTypeOf<SessionIndexUpdate['session']>().toHaveProperty('lastMessagePreviewMessageId')
    expectTypeOf<SessionIndexUpdate['session']>().toHaveProperty('lastMessagePreviewAt')
    expectTypeOf<SessionIndexUpdate['session']>().toHaveProperty('lastVisibleEventAt')
    expectTypeOf<SessionIndexUpdate>().toHaveProperty('protocolVersion')
    expectTypeOf<SessionIndexUpdate>().toHaveProperty('dataEpoch')
    expectTypeOf<SessionIndexUpdate>().toHaveProperty('daemonInstallationId')
    expectTypeOf<SessionIndexUpdate['session']>().toHaveProperty('bodyRevision')
    expectTypeOf<SessionIndexUpdate['session']>().toHaveProperty('indexRevision')
    expectTypeOf<SessionIndexUpdate['session']>().toHaveProperty('titleSource')
    expectTypeOf<SessionIndexUpdate['session']>().toHaveProperty('deletionRevision')
    expectTypeOf<SessionIndexUpdate['session']>().toHaveProperty('attentionCount')
    expectTypeOf<SessionIndexUpdate['session']>().toHaveProperty('lastAttentionId')
    expectTypeOf<SessionIndexUpdate['session']>().not.toHaveProperty('userId')
    expectTypeOf<SessionIndexUpdate['session']>().not.toHaveProperty('machineId')
    expectTypeOf<SessionIndexUpdate['session']>().not.toHaveProperty('canManage')
  })

  it('requires revisioned daemon deletion catch-up before discovery', () => {
    expectTypeOf<SessionDeletionsSyncParams>().toHaveProperty('daemonInstallationId')
    expectTypeOf<SessionDeletionsSyncParams>().toHaveProperty('afterRevision')
    expectTypeOf<SessionDeletionCommand>().toHaveProperty('deletionRevision')
    expectTypeOf<SessionDeletionCommand>().toHaveProperty('sources')
    expectTypeOf<SessionDeletionCommand['workDir']>().toEqualTypeOf<string | undefined>()
    expectTypeOf<SessionDeletionCommand['nativeCleanupPolicy']>()
      .toEqualTypeOf<NativeCleanupPolicy>()
    expectTypeOf<SessionDeletionsAckParams>().toHaveProperty('deletionRevision')

    const currentCommand: SessionDeletionCommand = {
      sessionId: 'current-session', deletionRevision: 1,
      deletedAt: '2026-09-02T00:00:00.000Z', sources: [],
      nativeCleanupPolicy: 'auto',
    }
    expect(currentCommand.nativeCleanupPolicy).toBe('auto')
  })

  it('keeps Voice body and tool detail requests scoped to one target', () => {
    expectTypeOf<VoiceSessionBodyWindowParams>().toHaveProperty('sessionId')
    expectTypeOf<VoiceSessionBodyWindowParams>().toHaveProperty('callId')
    expectTypeOf<SessionToolDetailRequest>().toHaveProperty('toolCallId')
    expectTypeOf<SessionToolDetailRequest>().toHaveProperty('detailRevision')
    expectTypeOf<SessionToolDetailRequest>().not.toHaveProperty('messageId')
    expectTypeOf<SessionToolDetailResponse>().toHaveProperty('byteSize')
    expectTypeOf<SessionToolDetailResponse>().toHaveProperty('redacted')
    expectTypeOf<SessionToolDetailResponse>().toHaveProperty('expiresAt')
    expect(SESSION_TOOL_DETAIL_LIMITS.maxMaxBytes).toBe(64 * 1024)
    expect(SESSION_TOOL_DETAIL_LIMITS.relayTimeoutMs).toBeLessThan(
      SESSION_TOOL_DETAIL_LIMITS.responseTtlMs,
    )
  })
})

describe('steward session scope', () => {
  it('is hidden from ordinary lists and native import, and absent scope stays personal', async () => {
    const { isInternalSession, isStewardSession } = await import('../session.ts')
    expect(isStewardSession({ sessionScope: 'steward' })).toBe(true)
    expect(isStewardSession({ sessionScope: 'personal' })).toBe(false)
    expect(isStewardSession({})).toBe(false)
    expect(isInternalSession({ id: 'sess_1', sessionScope: 'steward' })).toBe(true)
    expect(isInternalSession({ id: 'sess_1' })).toBe(false)
    expect(isInternalSession({ id: 'sess_1', sessionScope: 'personal' })).toBe(false)
  })
})
