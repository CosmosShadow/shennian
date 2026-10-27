// @covers src/room/activation-policy.ts

import { describe, expect, it } from 'vitest'
import type { RoomMessageView } from '@shennian/wire'
import { selectRoomActivationTargets } from '../room/activation-policy.js'
import type { RoomSessionRegistration } from '../room/session-registry.js'

describe('Room activation target policy', () => {
  it('sends an ordinary human message only to active auto-follow Agents', () => {
    expect(selectIds(humanMessage(), [
      registration('auto', 'auto_follow'),
      registration('mention', 'mention_only'),
      registration('paused', 'paused', 'paused'),
      registration('detached', 'auto_follow', 'detached'),
    ])).toEqual(['auto'])
  })

  it('sends a human Agent mention only to the exact mentioned Agents regardless of auto-follow', () => {
    const message = humanMessage([
      { membershipId: 'member_mention', principalType: 'agent', displayName: 'Mention' },
      { membershipId: 'human_other', principalType: 'human', displayName: 'Other' },
    ])
    expect(selectIds(message, [
      registration('auto', 'auto_follow'),
      registration('mention', 'mention_only'),
      registration('other', 'mention_only'),
    ])).toEqual(['mention'])
  })

  it('does not fan out Agent messages unless another exact Agent is mentioned', () => {
    const registrations = [
      registration('author', 'auto_follow'),
      registration('target', 'mention_only'),
      registration('observer', 'auto_follow'),
    ]
    expect(selectIds(agentMessage(), registrations)).toEqual([])
    expect(selectIds(agentMessage([
      { membershipId: 'member_author', principalType: 'agent', displayName: 'Self' },
      { membershipId: 'member_target', principalType: 'agent', displayName: 'Target' },
    ]), registrations)).toEqual(['target'])
  })

  it('never selects closed, paused, pending, detached, deleted, or untyped system inputs', () => {
    const closed = registration('closed', 'auto_follow')
    closed.lifecycleState = 'closed'
    expect(selectIds(humanMessage(), [closed])).toEqual([])
    expect(selectIds({ ...humanMessage(), deletedAt: new Date().toISOString() }, [
      registration('auto', 'auto_follow'),
    ])).toEqual([])
    expect(selectIds({ ...humanMessage(), kind: 'system' }, [
      registration('auto', 'auto_follow'),
    ])).toEqual([])
  })

  it('sends supported Room events only to auto-follow Agents and never to the subject Agent', () => {
    const event = {
      ...humanMessage(),
      kind: 'system' as const,
      source: 'system' as const,
      text: 'New member joined the Room.',
      systemEvent: {
        type: 'membership_joined' as const,
        subjectMembershipId: 'member_subject',
        subjectPrincipalType: 'human' as const,
      },
    }
    expect(selectIds(event, [
      registration('auto', 'auto_follow'),
      registration('mention', 'mention_only'),
      registration('paused', 'paused', 'paused'),
      registration('subject', 'auto_follow'),
    ])).toEqual(['auto'])
  })

  it('does not wake Agents for Agent joins or technical system notices', () => {
    const base = { ...humanMessage(), kind: 'system' as const, source: 'system' as const }
    expect(selectIds({
      ...base,
      systemEvent: {
        type: 'membership_joined',
        subjectMembershipId: 'member_new_agent',
        subjectPrincipalType: 'agent',
      },
    }, [registration('auto', 'auto_follow')])).toEqual([])
    expect(selectIds({
      ...base,
      systemEvent: { type: 'agent_unavailable' },
    }, [registration('auto', 'auto_follow')])).toEqual([])
  })
})

function selectIds(message: RoomMessageView, registrations: RoomSessionRegistration[]): string[] {
  return selectRoomActivationTargets(message, registrations)
    .map((target) => target.registration.binding!.agentMembershipId!.replace('member_', ''))
}

function humanMessage(mentions: RoomMessageView['mentions'] = []): RoomMessageView {
  return message('human', 'human_author', mentions)
}

function agentMessage(mentions: RoomMessageView['mentions'] = []): RoomMessageView {
  return message('agent', 'member_author', mentions)
}

function message(
  principalType: 'human' | 'agent',
  membershipId: string,
  mentions: RoomMessageView['mentions'],
): RoomMessageView {
  return {
    id: 'message_1',
    roomId: 'room_1',
    sequence: '7',
    kind: 'text',
    author: {
      membershipId,
      principalType,
      ownerUserId: 'user_1',
      displayName: 'Author',
    },
    mentions,
    text: 'hello',
    attachments: [],
    createdAt: new Date().toISOString(),
  }
}

function registration(
  id: string,
  activationMode: 'auto_follow' | 'mention_only' | 'paused',
  status: 'active' | 'paused' | 'pending_approval' | 'detached' = 'active',
): RoomSessionRegistration {
  return {
    schemaVersion: 1,
    registryKey: id.padEnd(64, 'a'),
    machineId: 'machine_1',
    runtimeAdapter: 'codex',
    sourceSessionKey: `source_${id}`,
    nianSessionId: `nian_${id}`,
    panelContextKey: `nian_${id}`,
    hostProcessIdentity: `process_${id}`,
    registrationEpoch: 1,
    lifecycleState: 'active',
    capabilities: {
      canIdentifySession: true,
      canBindAutomatically: true,
      canOpenEmbeddedRoomPage: false,
      canResumeIdleSession: true,
      canActivateWhileHostOpen: false,
    },
    binding: {
      bindingId: `binding_${id}`,
      roomId: 'room_1',
      agentIdentityId: `identity_${id}`,
      agentMembershipId: `member_${id}`,
      status,
      activationMode,
      lastDeliveredSequence: '0',
      lastActivatedSequence: '0',
      activationQueue: [],
      activeActivation: null,
      loopBreaker: { windowStartedAt: null, activationCount: 0, pausedUntil: null },
    },
    registeredAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}
