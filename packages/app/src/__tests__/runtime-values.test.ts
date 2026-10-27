// @covers ../utils/runtimeValues.ts
// @covers ../features/contacts/contactValues.ts
// @covers ../../../../open-source/packages/shared/src/lib/agentTheme.ts
import { describe, expect, it } from 'vitest'
import { isRecord, routeString } from '../utils/runtimeValues'
import { normalizeContacts } from '../features/contacts/contactValues'
import { getAgentDisplayName, getAgentAbbreviation } from '../../../../open-source/packages/shared/src/lib/agentTheme'
import type { AgentType } from '@shennian/wire'

describe('UI runtime data boundaries', () => {
  it.each([null, undefined, [], 42, 'x'])('does not treat %j as a record', value => expect(isRecord(value)).toBe(false))
  it('rejects repeated/object route IDs instead of coercing them into a navigation target', () => {
    expect(routeString('agent-a')).toBe('agent-a')
    expect(routeString(['agent-a'])).toBe('agent-a')
    for (const input of [['a', 'b'], {}, null, 12]) expect(routeString(input)).toBe('')
  })
  it('keeps valid contacts while removing unsafe IDs/avatars and normalizing display-only labels', () => {
    expect(normalizeContacts([null, { id: {}, kind: 'human' }, { id: 'bad', kind: 'other' },
      { id: 'contact-a', kind: 'agent', displayName: { id: 'label', name: 'Agent A' },
        avatar: { smallUrl: {}, mediumUrl: 'image' }, owned: 'false', agentWorkspaceId: {} },
    ])).toEqual([{ id: 'contact-a', kind: 'agent', displayName: 'Agent A', avatar: null }])
    expect(normalizeContacts({})).toEqual([])
  })
  it('does not call string methods on an invalid provider type/displayName', () => {
    expect(getAgentDisplayName('codex', {} as string)).toBe('Codex')
    expect(getAgentDisplayName({} as AgentType, {} as string)).toBe('AI')
    expect(getAgentAbbreviation(null as unknown as AgentType)).toBe('AI')
    expect(getAgentDisplayName('custom:dsh', 'DSH')).toBe('DSH')
  })
})

it('does not return inherited Object prototype members as provider labels', () => {
  expect(getAgentDisplayName('constructor' as AgentType)).toBe('Constructor')
  expect(getAgentAbbreviation('toString' as AgentType)).toBe('TO')
})
