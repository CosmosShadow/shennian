// @covers open-source/packages/server/src/services/room-agent-delivery-notices.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { tx, prisma, broadcastRoomEvent } = vi.hoisted(() => {
  const transaction = {
    room: { update: vi.fn() },
    roomMessage: { create: vi.fn() },
  }
  return {
    tx: transaction,
    prisma: {
      roomBinding: { findMany: vi.fn() },
      $transaction: vi.fn((work: (client: typeof transaction) => unknown) => work(transaction)),
    },
    broadcastRoomEvent: vi.fn(),
  }
})

vi.mock('../lib/prisma.js', () => ({ prisma }))
vi.mock('../services/room-events.js', () => ({ broadcastRoomEvent }))

import {
  agentUnavailableReason,
  noticeUnavailableAgents,
} from '../services/room-agent-delivery-notices.js'

const online = { paired: true, online: true }
const offline = { paired: true, online: false }

function binding(overrides: Record<string, unknown>) {
  return {
    id: 'binding_1',
    status: 'active',
    activationMode: 'auto_follow',
    detachedReason: null,
    machine: offline,
    agentMembership: {
      id: 'agent_1',
      principalType: 'agent',
      ownerUserId: 'user_2',
      displayAlias: 'Opencode',
    },
    ...overrides,
  }
}

describe('agentUnavailableReason', () => {
  it.each([
    ['auto_follow, machine offline', { activationMode: 'auto_follow', machine: offline }, false, 'machine_offline'],
    ['auto_follow, machine online', { activationMode: 'auto_follow', machine: online }, false, null],
    ['mention_only, not mentioned, offline', { activationMode: 'mention_only', machine: offline }, false, null],
    ['mention_only, mentioned, offline', { activationMode: 'mention_only', machine: offline }, true, 'machine_offline'],
    ['paused, not mentioned', { activationMode: 'paused', status: 'paused', machine: offline }, false, null],
    ['paused, mentioned', { activationMode: 'paused', status: 'paused', machine: online }, true, 'paused'],
    ['recovering', { detachedReason: 'recovering', status: 'detached', machine: offline }, false, 'recovering'],
    ['detached, mentioned', { activationMode: 'paused', status: 'detached', machine: online }, true, 'unavailable'],
    ['machine unpaired', { machine: { paired: false, online: false } }, false, 'unavailable'],
  ])('%s', (_name, overrides, mentioned, expected) => {
    const base = { status: 'active', activationMode: 'auto_follow', detachedReason: null, machine: online }
    expect(agentUnavailableReason({ ...base, ...overrides }, mentioned)).toBe(expected)
  })
})

describe('noticeUnavailableAgents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    tx.room.update.mockResolvedValue({ nextSequence: 8n })
    tx.roomMessage.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: `notice_${data.clientMessageId}`,
      createdAt: new Date('2026-09-20T00:00:00.000Z'),
      editedAt: null,
      deletedAt: null,
      replyToMessageId: null,
      authorAvatarSnapshot: null,
      ...data,
    }))
  })

  const sent = {
    id: 'message_1',
    roomId: 'room_1',
    authorMembershipId: 'human_1',
    mentionSnapshots: null,
  }

  it('appends one system notice per unreachable agent and broadcasts it, every time', async () => {
    prisma.roomBinding.findMany.mockResolvedValue([
      binding({ id: 'binding_1' }),
      binding({
        id: 'binding_2',
        machine: online,
        agentMembership: { id: 'agent_2', principalType: 'agent', ownerUserId: 'user_2', displayAlias: 'Pi' },
      }),
      binding({
        id: 'binding_3',
        machine: offline,
        agentMembership: { id: 'agent_3', principalType: 'agent', ownerUserId: 'user_3', displayAlias: 'Claude' },
      }),
    ])

    await noticeUnavailableAgents(sent)
    await noticeUnavailableAgents({ ...sent, id: 'message_2' })

    const texts = tx.roomMessage.create.mock.calls.map(([arg]) => arg.data.text)
    expect(texts).toEqual([
      "Opencode's machine is offline and cannot respond to this message.",
      "Claude's machine is offline and cannot respond to this message.",
      "Opencode's machine is offline and cannot respond to this message.",
      "Claude's machine is offline and cannot respond to this message.",
    ])
    expect(tx.roomMessage.create.mock.calls[0]![0].data).toMatchObject({
      kind: 'system',
      source: 'system',
      authorMembershipId: 'agent_1',
      clientMessageId: 'system:agent-unavailable:message_1:binding_1',
    })
    expect(broadcastRoomEvent).toHaveBeenCalledTimes(4)
    expect(broadcastRoomEvent.mock.calls[0]![1]).toMatchObject({
      event: 'room.message.created',
      roomId: 'room_1',
      message: { kind: 'system', source: 'system' },
    })
  })

  it('uses structured mentions so a mention-only agent is noticed only when mentioned', async () => {
    prisma.roomBinding.findMany.mockResolvedValue([
      binding({ activationMode: 'mention_only' }),
    ])

    await noticeUnavailableAgents(sent)
    expect(tx.roomMessage.create).not.toHaveBeenCalled()

    await noticeUnavailableAgents({ ...sent, mentionSnapshots: [{ membershipId: 'agent_1' }] })
    expect(tx.roomMessage.create).toHaveBeenCalledTimes(1)
  })

  it('never throws into the send path when lookup or append fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    prisma.roomBinding.findMany.mockRejectedValueOnce(new Error('db down'))
    await expect(noticeUnavailableAgents(sent)).resolves.toBeUndefined()

    prisma.roomBinding.findMany.mockResolvedValue([binding({})])
    tx.roomMessage.create.mockRejectedValueOnce(new Error('unique'))
    await expect(noticeUnavailableAgents(sent)).resolves.toBeUndefined()
    expect(broadcastRoomEvent).not.toHaveBeenCalled()
  })
})
