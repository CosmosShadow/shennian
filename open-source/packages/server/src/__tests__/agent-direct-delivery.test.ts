// @covers open-source/packages/server/src/services/agent-direct-delivery.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_MANAGED_AGENT_PERMISSION_POLICY } from '@shennian/wire'

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(), query: vi.fn(), candidates: vi.fn(), message: vi.fn(),
  messageCount: vi.fn(), messageUpdateMany: vi.fn(), messageUpdate: vi.fn(),
  messageCreate: vi.fn(), conversation: vi.fn(), conversationUpdate: vi.fn(),
  publication: vi.fn(), agent: vi.fn(), bindingCreate: vi.fn(), bindingUpdate: vi.fn(),
  bindingUpdateMany: vi.fn(), session: vi.fn(),
  sessionFindUnique: vi.fn(), sessionCreate: vi.fn(), machine: vi.fn(),
  directMessage: vi.fn(),
  roomMessageUpdateMany: vi.fn(), roomMessageFindUnique: vi.fn(),
  roomMessageCreate: vi.fn(), roomMessageUpdate: vi.fn(), roomUpdate: vi.fn(),
  roomMembershipFindUnique: vi.fn(), userFindUnique: vi.fn(), broadcastRoomMessage: vi.fn(),
  sessionUpdate: vi.fn(),
  attachments: vi.fn(),
  commitSessionDeletion: vi.fn(), finalizeSessionDeletion: vi.fn(),
}))
vi.mock('../lib/prisma.js', () => ({ prisma: { $transaction: mocks.transaction,
  agentDirectMessage: { findUnique: mocks.directMessage,
    updateMany: mocks.messageUpdateMany },
  roomMessage: { findUnique: mocks.roomMessageFindUnique } } }))
vi.mock('../services/room-events.js', () => ({
  broadcastRoomMessageRecord: mocks.broadcastRoomMessage,
}))
vi.mock('../services/sessions.js', () => ({
  commitSessionDeletionInTransaction: mocks.commitSessionDeletion,
  finalizeCommittedSessionDeletion: mocks.finalizeSessionDeletion,
}))

import {
  AgentDirectDeliveryError,
  bindAgentDirectSession,
  prepareAgentDirectSession,
  claimAgentDirectMessage,
  completeAgentDirectMessage,
  checkAgentDirectLease,
  saveAgentDirectNativeSession,
  failAgentDirectMessage,
} from '../services/agent-direct-delivery.js'

const now = new Date('2026-09-26T00:00:00Z')
const fingerprint = `sha256:${'a'.repeat(64)}`
const machineAgents = [{ type: 'codex', authState: 'ready',
  supportedAgentExecutionModes: ['restricted'], managedAgentProtection: {
  level: 'hard', runtimeVersion: '1.0.0', platform: 'darwin',
  executableFingerprint: fingerprint, unsupportedCapabilities: [],
  capabilityMatrix: {
    fileAccess: { 'workspace-read': true, 'workspace-write': false, 'host-full': false },
    externalCapabilities: Object.fromEntries(['commandNetwork', 'webSearch', 'browser',
      'computerUse', 'mcp'].map((key) => [key, { allow: false, deny: true }])),
  },
} }]
const candidate = { id: 'message-1', conversationId: 'conversation-1' }
const conversation = {
  id: 'conversation-1', publicationId: 'publication-1', agentIdentityId: 'agent-1',
  ownerUserId: 'owner-1', status: 'active',
  agentIdentity: { status: 'active', ownerUserId: 'owner-1', machineId: 'machine-1',
    runtimeAdapter: 'codex', configurationVersion: 4, workDir: '/private/owner-agent',
    sessionMode: 'standard', managerConfig: null, modelId: null,
    permissionPolicy: DEFAULT_MANAGED_AGENT_PERMISSION_POLICY,
    permissionPolicyVersion: 1 },
  binding: null,
}
const publication = { status: 'active', generation: 2, policyVersion: 3,
  ownerUserId: 'owner-1', agentIdentityId: 'agent-1' }
const message = { id: 'message-1', conversationId: 'conversation-1',
  authorRole: 'visitor', sequence: 1n, text: 'hello', status: 'pending', attempts: 0,
  publicationGeneration: 2, policyVersion: 3, agentConfigurationVersion: 4,
  leaseExpiresAt: null,
  claimTokenHash: null }
const staleSessionDeletion = { sessionId: 'old-session-1', userId: 'owner-1',
  machineId: 'old-machine', deletedAt: now.toISOString(), alreadyDeleted: false,
  deletionRevision: 1 }

describe('Agent direct host delivery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.transaction.mockImplementation(async (fn) => fn({
      $queryRaw: mocks.query,
      agentDirectMessage: {
        findMany: mocks.candidates, findUnique: mocks.message,
        count: mocks.messageCount, updateMany: mocks.messageUpdateMany,
        update: mocks.messageUpdate, create: mocks.messageCreate,
      },
      agentDirectAttachment: { findMany: mocks.attachments },
      roomMessage: { updateMany: mocks.roomMessageUpdateMany,
        findUnique: mocks.roomMessageFindUnique, create: mocks.roomMessageCreate,
        update: mocks.roomMessageUpdate },
      room: { update: mocks.roomUpdate },
      roomMembership: { findUnique: mocks.roomMembershipFindUnique },
      user: { findUnique: mocks.userFindUnique },
      agentDirectConversation: { findUnique: mocks.conversation, update: mocks.conversationUpdate },
      agentPublication: { findUnique: mocks.publication },
      agentIdentity: { findUnique: mocks.agent },
      agentDirectBinding: { create: mocks.bindingCreate, update: mocks.bindingUpdate,
        updateMany: mocks.bindingUpdateMany },
      nianSession: { findFirst: mocks.session, findUnique: mocks.sessionFindUnique,
        create: mocks.sessionCreate, update: mocks.sessionUpdate },
      machine: { findFirst: mocks.machine, findUnique: mocks.machine },
    }))
    mocks.candidates.mockResolvedValue([candidate])
    mocks.conversation.mockResolvedValue(conversation)
    mocks.message.mockResolvedValue(message)
    mocks.attachments.mockResolvedValue([])
    mocks.publication.mockResolvedValue(publication)
    mocks.agent.mockResolvedValue(conversation.agentIdentity)
    mocks.messageCount.mockResolvedValue(0)
    mocks.messageUpdateMany.mockResolvedValue({ count: 1 })
    mocks.bindingCreate.mockResolvedValue({ id: 'binding-1', bindingEpoch: 1 })
    mocks.query.mockResolvedValue([{ id: 'locked' }])
    mocks.bindingUpdateMany.mockResolvedValue({ count: 1 })
    mocks.machine.mockResolvedValue({ daemonInstallationId: 'daemon-1', agents: machineAgents })
    mocks.commitSessionDeletion.mockResolvedValue(staleSessionDeletion)
    mocks.roomMessageFindUnique.mockResolvedValue({ roomId: 'conversation-1', text: 'hello' })
  })

  it('does not deliver a turn from an old publication generation', async () => {
    mocks.publication.mockResolvedValue({ ...publication, generation: 3 })
    const result = await claimAgentDirectMessage({ ownerUserId: 'owner-1', machineId: 'machine-1', now })
    expect(result.claim).toBeNull()
    expect(mocks.messageUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'cancelled' }),
    }))
    expect(mocks.bindingCreate).not.toHaveBeenCalled()
  })

  it('cancels pending work after the Owner changes Agent instructions', async () => {
    mocks.agent.mockResolvedValue({ ...conversation.agentIdentity, configurationVersion: 5 })
    const result = await claimAgentDirectMessage({ ownerUserId: 'owner-1', machineId: 'machine-1', now })
    expect(result.claim).toBeNull()
    expect(mocks.messageUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'cancelled' }),
    }))
  })

  it('does not claim a Manager Agent before public worker isolation exists', async () => {
    mocks.agent.mockResolvedValue({ ...conversation.agentIdentity, sessionMode: 'manager' })
    const result = await claimAgentDirectMessage({ ownerUserId: 'owner-1', machineId: 'machine-1', now })
    expect(result.claim).toBeNull()
    expect(mocks.messageUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'cancelled' }),
    }))
  })

  it('claims one turn for the exact machine and returns a short lease', async () => {
    const result = await claimAgentDirectMessage({ ownerUserId: 'owner-1', machineId: 'machine-1', now })
    expect(mocks.candidates).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ conversation: expect.objectContaining({
        messages: { none: { status: 'running', leaseExpiresAt: { gt: now } } },
      }) }),
      orderBy: [{ conversation: { lastActivityAt: 'asc' } },
        { createdAt: 'asc' }, { id: 'asc' }],
    }))
    expect(result.claim).toMatchObject({ conversationId: 'conversation-1',
      agentIdentityId: 'agent-1', bindingId: 'binding-1', bindingEpoch: 1,
      executableFingerprint: fingerprint,
      text: 'hello', leaseExpiresAt: '2026-09-26T00:10:00.000Z' })
    expect(result.claim?.leaseToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(mocks.messageUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'running',
        claimTokenHash: expect.stringMatching(/^[a-f0-9]{64}$/) }),
    }))
    expect(JSON.stringify(mocks.messageUpdateMany.mock.calls)).not.toContain(result.claim?.leaseToken)
    expect(mocks.conversationUpdate).toHaveBeenCalledWith({
      where: { id: 'conversation-1' }, data: { lastActivityAt: now },
    })
  })

  it('claims canonical Room text through the unchanged delivery contract', async () => {
    mocks.conversation.mockResolvedValue({ ...conversation,
      roomId: 'conversation-1', canonicalState: 'ready' })
    mocks.message.mockResolvedValue({ ...message, text: null, roomMessageId: 'message-1' })
    const result = await claimAgentDirectMessage({
      ownerUserId: 'owner-1', machineId: 'machine-1', now,
    })
    expect(result.claim).toMatchObject({ conversationId: 'conversation-1',
      messageId: 'message-1', sequence: '1', text: 'hello' })
    expect(mocks.roomMessageUpdate).toHaveBeenCalledWith({ where: { id: 'message-1' },
      data: { deliveryStatus: 'running' } })
  })

  it('tombstones the old epoch’s hidden Session through the controlled deletion state machine when a binding rotates', async () => {
    mocks.conversation.mockResolvedValue({ ...conversation,
      binding: { id: 'binding-1', bindingEpoch: 1, machineId: 'old-machine',
        runtimeAdapter: 'codex', appliedPolicyVersion: 2, nianSessionId: 'old-session-1' } })
    mocks.bindingUpdate.mockResolvedValue({ id: 'binding-1', bindingEpoch: 2 })
    const result = await claimAgentDirectMessage({ ownerUserId: 'owner-1', machineId: 'machine-1', now })
    expect(mocks.commitSessionDeletion).toHaveBeenCalledTimes(1)
    expect(mocks.commitSessionDeletion).toHaveBeenCalledWith(
      expect.anything(), 'old-session-1', 'owner-1', { nativeCleanupPolicy: 'auto', deletedAt: now })
    expect(mocks.bindingUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'binding-1' },
      data: expect.objectContaining({ nianSessionId: null, bindingEpoch: { increment: 1 } }),
    }))
    // The stale Session's deletion is only finalized (broadcast) once the
    // surrounding claim transaction actually commits, not from inside it.
    expect(mocks.finalizeSessionDeletion).toHaveBeenCalledTimes(1)
    expect(mocks.finalizeSessionDeletion).toHaveBeenCalledWith(staleSessionDeletion)
    expect(result.claim).toMatchObject({ bindingId: 'binding-1', bindingEpoch: 2 })
  })

  it('does not tombstone a Session whose binding still matches the current machine, Adapter, and policy', async () => {
    mocks.conversation.mockResolvedValue({ ...conversation,
      binding: { id: 'binding-1', bindingEpoch: 1, machineId: 'machine-1',
        runtimeAdapter: 'codex', appliedPolicyVersion: 3, nianSessionId: 'session-1' } })
    const result = await claimAgentDirectMessage({ ownerUserId: 'owner-1', machineId: 'machine-1', now })
    expect(mocks.commitSessionDeletion).not.toHaveBeenCalled()
    expect(mocks.bindingUpdate).not.toHaveBeenCalled()
    expect(mocks.finalizeSessionDeletion).not.toHaveBeenCalled()
    expect(result.claim).toMatchObject({ bindingId: 'binding-1', bindingEpoch: 1 })
  })

  it('refuses to hand out public work without a current hard runtime fingerprint', async () => {
    mocks.machine.mockResolvedValue({ agents: [] })
    const result = await claimAgentDirectMessage({ ownerUserId: 'owner-1', machineId: 'machine-1', now })
    expect(result.claim).toBeNull()
    expect(mocks.bindingCreate).not.toHaveBeenCalled()
  })

  it('refuses a claim when the reported runtime loses authentication or deny capability', async () => {
    mocks.machine.mockResolvedValue({ agents: [{ ...machineAgents[0], authState: 'required' }] })
    const unauthenticated = await claimAgentDirectMessage({
      ownerUserId: 'owner-1', machineId: 'machine-1', now,
    })
    expect(unauthenticated.claim).toBeNull()
    expect(mocks.bindingCreate).not.toHaveBeenCalled()
    // A `partial` runtime (no full OS sandbox) is now accepted on its own —
    // same bar Room chat already uses — but a genuine capability leak (the
    // runtime cannot actually guarantee denying an external capability)
    // still blocks regardless of level.
    mocks.machine.mockResolvedValue({ agents: [{ ...machineAgents[0],
      managedAgentProtection: { ...machineAgents[0]!.managedAgentProtection,
        capabilityMatrix: {
          ...machineAgents[0]!.managedAgentProtection.capabilityMatrix,
          externalCapabilities: {
            ...machineAgents[0]!.managedAgentProtection.capabilityMatrix.externalCapabilities,
            commandNetwork: { allow: false, deny: false },
          },
        } } }] })
    const gap = await claimAgentDirectMessage({ ownerUserId: 'owner-1', machineId: 'machine-1', now })
    expect(gap.claim).toBeNull()
    expect(mocks.bindingCreate).not.toHaveBeenCalled()
  })

  it('delivers with supported Codex permissions without adding a public-only hard gate', async () => {
    mocks.machine.mockResolvedValue({ agents: [{ ...machineAgents[0],
      managedAgentProtection: { ...machineAgents[0]!.managedAgentProtection, level: 'partial' } }] })
    const result = await claimAgentDirectMessage({ ownerUserId: 'owner-1', machineId: 'machine-1', now })
    expect(result.claim).toMatchObject({ messageId: 'message-1', executableFingerprint: fingerprint })
  })

  it('withholds file turns from old daemons and includes metadata for capable daemons', async () => {
    const file = { id: `datt_${'a'.repeat(36)}`, name: 'photo.png',
      mimeType: 'image/png', mediaKind: 'image', byteSize: 10n,
      sha256: 'b'.repeat(64), status: 'ready', expiresAt: new Date(now.getTime() + 60_000) }
    mocks.attachments.mockResolvedValue([file])
    const old = await claimAgentDirectMessage({ ownerUserId: 'owner-1', machineId: 'machine-1', now })
    expect(old.claim).toBeNull()
    const capable = await claimAgentDirectMessage({ ownerUserId: 'owner-1', machineId: 'machine-1',
      supportsAttachments: true, now })
    expect(capable.claim).toMatchObject({ attachments: [{ attachmentId: file.id,
      name: 'photo.png', byteSize: '10' }] })
  })

  it('does not claim another turn while this Owner machine has a live lease', async () => {
    mocks.messageCount.mockResolvedValue(1)
    await expect(claimAgentDirectMessage({ ownerUserId: 'owner-1', machineId: 'machine-1', now }))
      .resolves.toEqual({ claim: null })
    expect(mocks.candidates).not.toHaveBeenCalled()
    expect(mocks.messageCount).toHaveBeenCalledWith({ where: {
      status: 'running', leaseExpiresAt: { gt: now }, conversation: {
        ownerUserId: 'owner-1', agentIdentity: { machineId: 'machine-1' },
      },
    } })
  })

  it('caps all of a publisher’s machines at two active public turns', async () => {
    mocks.messageCount.mockResolvedValueOnce(2)
    await expect(claimAgentDirectMessage({ ownerUserId: 'owner-1', machineId: 'machine-1', now }))
      .resolves.toEqual({ claim: null })
    expect(mocks.messageCount).toHaveBeenCalledWith({ where: {
      status: 'running', leaseExpiresAt: { gt: now }, conversation: { ownerUserId: 'owner-1' },
    } })
    expect(mocks.candidates).not.toHaveBeenCalled()
  })

  it('does not claim work after its publisher account disappears', async () => {
    mocks.query.mockResolvedValueOnce([])
    await expect(claimAgentDirectMessage({ ownerUserId: 'owner-1', machineId: 'machine-1', now }))
      .resolves.toEqual({ claim: null })
    expect(mocks.messageCount).not.toHaveBeenCalled()
  })

  it('rejects completion without this turn lease', async () => {
    mocks.conversation.mockResolvedValue({ ...conversation,
      binding: { id: 'binding-1', bindingEpoch: 1 } })
    mocks.message.mockResolvedValue({ ...message, status: 'running',
      leaseExpiresAt: new Date('2026-09-26T00:10:00Z'), claimTokenHash: 'wrong' })
    await expect(completeAgentDirectMessage({
      ownerUserId: 'owner-1', machineId: 'machine-1',
      messageId: 'message-1', conversationId: 'conversation-1', bindingEpoch: 1,
      leaseToken: 'x'.repeat(43), replyText: 'answer', now,
    })).rejects.toBeInstanceOf(AgentDirectDeliveryError)
    expect(mocks.messageCreate).not.toHaveBeenCalled()
  })

  it('will not acknowledge a public reply without a persisted private native Session', async () => {
    const token = 'x'.repeat(43)
    const crypto = await import('node:crypto')
    mocks.conversation.mockResolvedValue({ ...conversation, publication,
      binding: { id: 'binding-1', bindingEpoch: 1, nianSessionId: 'session-1' } })
    mocks.message.mockResolvedValue({ ...message, status: 'running',
      leaseExpiresAt: new Date('2026-09-26T00:10:00Z'),
      claimTokenHash: crypto.createHash('sha256').update(token).digest('hex') })
    mocks.session.mockResolvedValue({ id: 'session-1', agentSessionId: null })
    const input = { ownerUserId: 'owner-1', machineId: 'machine-1',
      messageId: 'message-1', conversationId: 'conversation-1', bindingEpoch: 1,
      leaseToken: token, replyText: 'answer', now }
    await expect(completeAgentDirectMessage(input)).rejects.toMatchObject({ code: 'stale' })
    expect(mocks.messageCreate).not.toHaveBeenCalled()
    mocks.session.mockResolvedValue({ id: 'session-1', agentSessionId: 'native-1' })
    mocks.conversationUpdate.mockResolvedValue({ nextSequence: 2n })
    mocks.messageCreate.mockResolvedValue({ id: 'reply-1' })
    await expect(completeAgentDirectMessage(input)).resolves.toEqual({
      replyMessageId: 'reply-1', sequence: '2', idempotent: false,
    })
  })

  it('pauses only the claimed visitor after saving its reply and cancels only its backlog', async () => {
    const token = 'x'.repeat(43)
    const crypto = await import('node:crypto')
    mocks.conversation.mockResolvedValue({ ...conversation, publication,
      binding: { id: 'binding-1', bindingEpoch: 1, nianSessionId: 'session-1' } })
    mocks.message.mockResolvedValue({ ...message, status: 'running',
      leaseExpiresAt: new Date('2026-09-26T00:10:00Z'),
      claimTokenHash: crypto.createHash('sha256').update(token).digest('hex') })
    mocks.session.mockResolvedValue({ id: 'session-1', agentSessionId: 'native-1' })
    mocks.conversationUpdate.mockResolvedValue({ nextSequence: 2n })
    mocks.messageCreate.mockResolvedValue({ id: 'reply-1' })
    await completeAgentDirectMessage({ ownerUserId: 'owner-1', machineId: 'machine-1',
      messageId: 'message-1', conversationId: 'conversation-1', bindingEpoch: 1,
      leaseToken: token, replyText: '这段对话已暂停。', pauseConversation: true, now })
    expect(mocks.conversationUpdate).toHaveBeenCalledWith({
      where: { id: 'conversation-1' },
      data: { status: 'paused', lastActivityAt: now },
    })
    expect(mocks.messageUpdateMany).toHaveBeenCalledWith({
      where: { conversationId: 'conversation-1', authorRole: 'visitor',
        status: { in: ['pending', 'running'] } },
      data: { status: 'cancelled', claimTokenHash: null, leaseExpiresAt: null },
    })
    expect(mocks.roomMessageUpdateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ legacyDirectMessage: { is: {
        status: 'cancelled', conversation: { id: 'conversation-1' },
      } } }),
      data: { deliveryStatus: 'cancelled' },
    })
  })

  it('completes a canonical turn in Room without a second transcript row', async () => {
    const token = 'x'.repeat(43)
    const crypto = await import('node:crypto')
    mocks.conversation.mockResolvedValue({ ...conversation,
      roomId: 'conversation-1', canonicalState: 'ready', publication,
      binding: { id: 'binding-1', bindingEpoch: 1, nianSessionId: 'session-1' } })
    mocks.message.mockResolvedValue({ ...message, text: null, status: 'running',
      leaseExpiresAt: new Date('2026-09-26T00:10:00Z'),
      claimTokenHash: crypto.createHash('sha256').update(token).digest('hex') })
    mocks.session.mockResolvedValue({ id: 'session-1', agentSessionId: 'native-1' })
    mocks.roomMembershipFindUnique.mockResolvedValue({ id: 'agent-member-1',
      displayAlias: 'Agent', status: 'active' })
    mocks.userFindUnique.mockResolvedValue({ name: 'Owner' })
    mocks.roomUpdate.mockResolvedValue({ nextSequence: 2n })
    mocks.roomMessageCreate.mockResolvedValue({ id: 'reply-1' })
    mocks.roomMessageFindUnique.mockResolvedValue({ id: 'reply-1', sequence: 2n,
      text: 'answer', attachments: [], authorMembership: { displayAlias: 'Agent', status: 'active' } })
    const result = await completeAgentDirectMessage({
      ownerUserId: 'owner-1', machineId: 'machine-1', messageId: 'message-1',
      conversationId: 'conversation-1', bindingEpoch: 1, leaseToken: token,
      replyText: 'answer', now,
    })
    expect(result).toEqual({ replyMessageId: 'reply-1', sequence: '2', idempotent: false })
    expect(mocks.roomMessageCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      roomId: 'conversation-1', sequence: 2n, text: 'answer',
      clientMessageId: 'reply:message-1',
    }), select: { id: true } })
    expect(mocks.messageCreate).not.toHaveBeenCalled()
    expect(mocks.broadcastRoomMessage).toHaveBeenCalledTimes(1)
  })

  it('lets only the current paired host keep a running public turn alive', async () => {
    const token = 'x'.repeat(43)
    const crypto = await import('node:crypto')
    const running = { ...message, status: 'running',
      leaseExpiresAt: new Date('2026-09-26T00:10:00Z'),
      claimTokenHash: crypto.createHash('sha256').update(token).digest('hex'),
      conversation: { ...conversation, publication,
        binding: { machineId: 'machine-1', bindingEpoch: 1,
          runtimeAdapter: 'codex', appliedPolicyVersion: 3 } } }
    mocks.directMessage.mockResolvedValue(running)
    const input = { ownerUserId: 'owner-1', machineId: 'machine-1',
      messageId: 'message-1', conversationId: 'conversation-1',
      bindingEpoch: 1, leaseToken: token, now }
    await expect(checkAgentDirectLease(input)).resolves.toEqual({
      valid: true, leaseExpiresAt: '2026-09-26T00:10:00.000Z',
    })
    await expect(checkAgentDirectLease({ ...input, machineId: 'other-machine' }))
      .rejects.toMatchObject({ code: 'stale' })
    mocks.directMessage.mockResolvedValue({ ...running,
      conversation: { ...running.conversation,
        publication: { ...publication, status: 'paused' } } })
    await expect(checkAgentDirectLease(input)).rejects.toMatchObject({ code: 'stale' })
    mocks.directMessage.mockResolvedValue({ ...running,
      conversation: { ...running.conversation,
        agentIdentity: { ...conversation.agentIdentity, configurationVersion: 5 } } })
    await expect(checkAgentDirectLease(input)).rejects.toMatchObject({ code: 'stale' })
  })

  it('marks a failed run promptly only while its lease remains current', async () => {
    const token = 'x'.repeat(43)
    const crypto = await import('node:crypto')
    mocks.directMessage.mockResolvedValue({ ...message, status: 'running',
      leaseExpiresAt: new Date('2026-09-26T00:10:00Z'),
      claimTokenHash: crypto.createHash('sha256').update(token).digest('hex'),
      conversation: { ...conversation, publication,
        binding: { machineId: 'machine-1', bindingEpoch: 1,
          runtimeAdapter: 'codex', appliedPolicyVersion: 3 } } })
    const input = { ownerUserId: 'owner-1', machineId: 'machine-1',
      messageId: 'message-1', conversationId: 'conversation-1',
      bindingEpoch: 1, leaseToken: token, failureCode: 'execution_failed', now }
    await expect(failAgentDirectMessage(input)).resolves.toEqual({ failed: true })
    expect(mocks.messageUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: 'failed', failureCode: 'execution_failed',
        claimTokenHash: null, leaseExpiresAt: null },
    }))
    await expect(failAgentDirectMessage({ ...input, failureCode: 'provider_limit' }))
      .resolves.toEqual({ failed: true })
    expect(mocks.messageUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: 'failed', failureCode: 'provider_limit',
        claimTokenHash: null, leaseExpiresAt: null },
    }))
    await expect(failAgentDirectMessage({ ...input, failureCode: 'unauthorized_tool_attempt' }))
      .resolves.toEqual({ failed: true })
    expect(mocks.messageUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: 'failed', failureCode: 'unauthorized_tool_attempt',
        claimTokenHash: null, leaseExpiresAt: null },
    }))
    await expect(failAgentDirectMessage({ ...input, failureCode: 'private-trace' }))
      .rejects.toMatchObject({ code: 'invalid' })
  })

  it('binds only a private Session on the exact owner machine and Agent', async () => {
    mocks.conversation.mockResolvedValue({ ...conversation,
      publication,
      binding: { id: 'binding-1', bindingEpoch: 1, machineId: 'machine-1', nianSessionId: null } })
    const token = 'x'.repeat(43)
    const crypto = await import('node:crypto')
    mocks.message.mockResolvedValue({ ...message, status: 'running',
      leaseExpiresAt: new Date('2026-09-26T00:10:00Z'),
      claimTokenHash: crypto.createHash('sha256').update(token).digest('hex') })
    mocks.session.mockResolvedValue({ id: 'session-1' })
    const input = { ownerUserId: 'owner-1', machineId: 'machine-1',
      messageId: 'message-1', conversationId: 'conversation-1', bindingEpoch: 1,
      leaseToken: token, nianSessionId: 'session-1', now }
    await expect(bindAgentDirectSession(input)).resolves.toEqual({
      bindingId: 'binding-1', bindingEpoch: 1, nianSessionId: 'session-1',
    })
    expect(mocks.session).toHaveBeenCalledWith({ where: expect.objectContaining({
      userId: 'owner-1', machineId: 'machine-1', agentIdentityId: 'agent-1',
      creationKey: 'published-agent:conversation-1:1',
      nativeSessionVisibility: 'internal', roomBinding: null,
    }), select: { id: true } })
    mocks.session.mockResolvedValue(null)
    await expect(bindAgentDirectSession(input)).rejects.toMatchObject({ code: 'unavailable' })
  })

  describe('visitor Sessions share the saved Agent directory', () => {
    const token = 'x'.repeat(43)
    const base = { ownerUserId: 'owner-1', machineId: 'machine-1',
      messageId: 'message-1', conversationId: 'conversation-1', bindingEpoch: 1,
      leaseToken: token, workDir: '/private/owner-agent', now }
    const existingSession = { id: 'session-1', userId: 'owner-1', machineId: 'machine-1',
      agentIdentityId: 'agent-1', agentType: 'codex', agentSessionId: 'native-1',
      nativeSessionVisibility: 'internal', status: 'active', roomBinding: null,
      workDir: '/private/published-agents/conversation-1' }

    beforeEach(async () => {
      const crypto = await import('node:crypto')
      mocks.conversation.mockResolvedValue({ ...conversation, publication,
        binding: { id: 'binding-1', bindingEpoch: 1, machineId: 'machine-1', nianSessionId: null } })
      mocks.message.mockResolvedValue({ ...message, status: 'running',
        leaseExpiresAt: new Date('2026-09-26T00:10:00Z'),
        claimTokenHash: crypto.createHash('sha256').update(token).digest('hex') })
      mocks.sessionFindUnique.mockResolvedValue(null)
      mocks.sessionCreate.mockResolvedValue({ id: 'session-1', agentSessionId: null })
    })

    it('creates separate hidden Sessions for two visitors in the same Agent directory', async () => {
      await expect(prepareAgentDirectSession(base)).resolves.toMatchObject({
        nianSessionId: 'session-1', workDir: '/private/owner-agent', nativeSessionId: null,
      })
      expect(mocks.sessionCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
        creationKey: 'published-agent:conversation-1:1',
        nativeSessionVisibility: 'internal', agentIdentityId: 'agent-1',
        workDir: '/private/owner-agent',
      }), select: expect.any(Object) })
      const secondConversation = { ...await mocks.conversation(), id: 'conversation-2',
        binding: { id: 'binding-2', bindingEpoch: 1, machineId: 'machine-1', nianSessionId: null } }
      mocks.conversation.mockResolvedValue(secondConversation)
      mocks.message.mockResolvedValue({ ...await mocks.message(), id: 'message-2', conversationId: 'conversation-2' })
      mocks.sessionCreate.mockResolvedValue({ id: 'session-2', agentSessionId: null })
      await expect(prepareAgentDirectSession({ ...base, conversationId: 'conversation-2', messageId: 'message-2' }))
        .resolves.toMatchObject({ nianSessionId: 'session-2', bindingId: 'binding-2', workDir: base.workDir })
      expect(mocks.sessionCreate).toHaveBeenLastCalledWith({ data: expect.objectContaining({
        creationKey: 'published-agent:conversation-2:1', workDir: base.workDir,
      }), select: expect.any(Object) })
    })

    it.each(['/private/another-agent', '/private/published-agents/conversation-2',
      '/private/../owner-agent', 'relative/agent', 'C:', '/bad\0path', ''])
    ('rejects an unrelated or invalid directory %j', async (workDir) => {
      await expect(prepareAgentDirectSession({ ...base, workDir })).rejects.toMatchObject({ code: 'invalid' })
      expect(mocks.sessionCreate).not.toHaveBeenCalled()
      expect(mocks.sessionUpdate).not.toHaveBeenCalled()
    })

    it('retains released daemons using the legacy visitor directory', async () => {
      const workDir = '/private/published-agents/conversation-1'
      await expect(prepareAgentDirectSession({ ...base, workDir })).resolves.toMatchObject({ workDir })
      expect(mocks.sessionCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ workDir }),
        select: expect.any(Object) })
    })

    it('moves an existing visitor Session to the Agent directory without resetting its context', async () => {
      mocks.sessionFindUnique.mockResolvedValue(existingSession)
      await expect(prepareAgentDirectSession(base)).resolves.toMatchObject({
        nianSessionId: 'session-1', nativeSessionId: 'native-1', bindingId: 'binding-1', workDir: base.workDir,
      })
      expect(mocks.sessionUpdate).toHaveBeenCalledExactlyOnceWith({ where: { id: 'session-1' },
        data: { workDir: base.workDir } })
      expect(mocks.sessionCreate).not.toHaveBeenCalled()
    })

    it('can roll back to a released daemon without losing this visitor context', async () => {
      mocks.sessionFindUnique.mockResolvedValue({ ...existingSession, workDir: base.workDir })
      await expect(prepareAgentDirectSession({ ...base, workDir: existingSession.workDir }))
        .resolves.toMatchObject({ nianSessionId: 'session-1', nativeSessionId: 'native-1' })
      expect(mocks.sessionUpdate).toHaveBeenCalledExactlyOnceWith({ where: { id: 'session-1' },
        data: { workDir: existingSession.workDir } })
    })

    it('does not rewrite an already-correct Session directory', async () => {
      mocks.sessionFindUnique.mockResolvedValue({ ...existingSession, workDir: base.workDir })
      await expect(prepareAgentDirectSession(base)).resolves.toMatchObject({ nativeSessionId: 'native-1' })
      expect(mocks.sessionUpdate).not.toHaveBeenCalled()
    })

    it.each([{ workDir: '/private/published-agents/conversation-2' },
      { agentIdentityId: 'agent-2' }, { nativeSessionVisibility: 'user' },
      { userId: 'another-owner' }, { machineId: 'another-machine' }])
    ('never adopts an unrelated Session %j', async (override) => {
      mocks.sessionFindUnique.mockResolvedValue({ ...existingSession, ...override })
      await expect(prepareAgentDirectSession(base)).rejects.toMatchObject({ code: 'stale' })
      expect(mocks.sessionUpdate).not.toHaveBeenCalled()
      expect(mocks.sessionCreate).not.toHaveBeenCalled()
    })

    it('matches Windows slash spellings for the saved Agent directory', async () => {
      mocks.conversation.mockResolvedValue({ ...await mocks.conversation(),
        agentIdentity: { ...conversation.agentIdentity, workDir: 'C:\\Users\\test\\agent\\' } })
      await expect(prepareAgentDirectSession({ ...base, workDir: 'C:/Users/test/agent' }))
        .resolves.toMatchObject({ workDir: 'C:/Users/test/agent' })
    })
  })

  it('persists a native Session only under its current visitor binding', async () => {
    const token = 'x'.repeat(43)
    const crypto = await import('node:crypto')
    mocks.conversation.mockResolvedValue({ ...conversation, publication,
      binding: { id: 'binding-1', bindingEpoch: 1, machineId: 'machine-1',
        nianSessionId: 'session-1' } })
    mocks.message.mockResolvedValue({ ...message, status: 'running',
      leaseExpiresAt: new Date('2026-09-26T00:10:00Z'),
      claimTokenHash: crypto.createHash('sha256').update(token).digest('hex') })
    mocks.session.mockResolvedValueOnce({ id: 'session-1', agentSessionId: null })
      .mockResolvedValueOnce(null)
    const input = { ownerUserId: 'owner-1', machineId: 'machine-1',
      messageId: 'message-1', conversationId: 'conversation-1', bindingEpoch: 1,
      leaseToken: token, nianSessionId: 'session-1', nativeSessionId: 'native-1', now }
    await expect(saveAgentDirectNativeSession(input)).resolves.toEqual({
      nianSessionId: 'session-1', nativeSessionId: 'native-1',
    })
    expect(mocks.sessionUpdate).toHaveBeenCalledWith({ where: { id: 'session-1' },
      data: { agentSessionId: 'native-1' } })
    mocks.session.mockReset().mockResolvedValue({ id: 'session-1', agentSessionId: 'other-native' })
    await expect(saveAgentDirectNativeSession(input)).rejects.toMatchObject({ code: 'stale' })
  })
})
