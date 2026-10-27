// @covers src/features/chat/hooks/useChatSendController.ts

import { useChatStore } from '@shennian/shared'
import { beforeEach, describe, expect, it } from 'vitest'
import { mutateActiveChatSession } from '../features/chat/utils/activeSessionMutation'

describe('chat async session mutation guard', () => {
  beforeEach(() => {
    useChatStore.getState().clear()
  })

  it('does not let a late send result from the previous conversation appear in the active one', () => {
    useChatStore.getState().setSessionId('session-new')
    useChatStore.getState().addMessage({
      id: 'new-message',
      role: 'agent',
      ts: 1,
      content: 'new conversation',
    })

    const applied = mutateActiveChatSession('session-old', (state) => {
      state.upsertMessage({
        id: 'late-old-message',
        role: 'user',
        ts: 2,
        content: 'must stay in the old conversation',
        status: 'sending',
      })
      state.clearPendingRun()
    })

    expect(applied).toBe(false)
    expect(useChatStore.getState().sessionId).toBe('session-new')
    expect(useChatStore.getState().messages.map((message) => message.id)).toEqual(['new-message'])
  })

  it('applies the same send result while its conversation is still active', () => {
    useChatStore.getState().setSessionId('session-current')

    const applied = mutateActiveChatSession('session-current', (state) => {
      state.upsertMessage({
        id: 'current-message',
        role: 'user',
        ts: 1,
        content: 'current conversation',
        status: 'sent',
      })
    })

    expect(applied).toBe(true)
    expect(useChatStore.getState().messages.map((message) => message.id)).toEqual([
      'current-message',
    ])
  })
})
