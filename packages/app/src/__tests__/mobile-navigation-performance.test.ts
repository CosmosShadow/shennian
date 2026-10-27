// @covers src/features/steward/stewardSessionsStore.ts
// @covers src/features/chat/hooks/useChatSessionHistory.ts
import { Window } from 'happy-dom'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, afterEach, expect, it, vi } from 'vitest'
import { useChatStore } from '@shennian/shared'
const fake = vi.hoisted(() => ({
  readTargets: vi.fn(async () => []), api: vi.fn(async () => ({ sessions: [] })),
  readState: vi.fn(async () => null), readBody: vi.fn(async () => []),
  subscribe: vi.fn(() => vi.fn()), sync: vi.fn(async () => {}), persist: vi.fn(async () => {}),
}))
vi.mock('react-native', () => ({ Platform: { OS: 'ios' }, AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) } }))
vi.mock('@react-navigation/native', () => ({ useIsFocused: () => true }))
vi.mock('../config/api', () => ({ authApi: fake.api }))
vi.mock('../config/auth', () => ({ useAuthStore: { getState: () => ({ user: { id: 'owner' } }) } }))
vi.mock('../../storage/db', () => ({ db: { getSessionSyncTargets: fake.readTargets }, personalSessionBodyStore: {
  getState: fake.readState, getMessagesByUserTurns: fake.readBody, subscribe: fake.subscribe,
} }))
vi.mock('../features/account-runtime/accountRuntime', () => ({ accountRuntime: { persistSession: fake.persist } }))
vi.mock('../features/chat/services/personalBodyReplicaSync', () => ({ syncVisiblePersonalSessionBody: fake.sync }))
vi.mock('../features/chat/utils/outboundStorage', () => ({
  getChatOutboundMessages: () => [], removeConfirmedChatOutboundMessages: vi.fn(),
}))
vi.mock('../features/chat/services/visibleBodyRecovery', () => ({ reportPersonalBodyReplicaFailure: vi.fn(), shouldRecoverVisibleBodyAfterRun: () => false }))
vi.mock('../../../storage/db', () => ({ personalSessionBodyStore: { getState: fake.readState, getMessagesByUserTurns: fake.readBody, subscribe: fake.subscribe } }))
import { useStewardSessionsStore } from '../features/steward/stewardSessionsStore'
import { useChatSessionHistory } from '../features/chat/hooks/useChatSessionHistory'
// Native-only db has no default .ts module; mock each importing module's virtual id.
const dom = new Window()
Object.assign(globalThis, { window: dom, document: dom.document, IS_REACT_ACT_ENVIRONMENT: true })
afterAll(async () => { await dom.happyDOM.close() })
afterEach(() => { vi.clearAllMocks(); useStewardSessionsStore.setState({ accountId: '', sessions: [], hydrated: false, deletedIds: new Set() }); useChatStore.getState().clear() })
it('hydrates once across simultaneous entry rows/controllers and repeated focuses', async () => {
  const store = useStewardSessionsStore.getState()
  await Promise.all([store.hydrate('owner'), store.hydrate('owner')])
  await store.hydrate('owner')
  expect(fake.readTargets).toHaveBeenCalledTimes(1)
  expect(useStewardSessionsStore.getState().hydrated).toBe(true)
  await store.hydrate('other-owner')
  expect(fake.readTargets).toHaveBeenCalledTimes(2)
})
it('coalesces concurrent index refreshes without suppressing later revalidation', async () => {
  const store = useStewardSessionsStore.getState()
  await Promise.all([store.refresh('owner'), store.refresh('owner')])
  expect(fake.api).toHaveBeenCalledTimes(1)
  await store.refresh('owner')
  expect(fake.api).toHaveBeenCalledTimes(2)
})
async function mountHistory(loadBody: boolean) {
  const root = createRoot(document.createElement('div'))
  const state = useChatStore.getState()
  const closeFileDrawer = vi.fn()
  function Probe() {
    useChatSessionHistory({ sessionId: 'session', session: undefined, messages: [], chatSessionId: null,
      isTyping: false, chatLoading: false, loadBody,
      clear: state.clear, closeFileDrawer, setSessionId: state.setSessionId,
      setMessages: state.setMessages, setChatLoading: state.setLoading,
      setHasMore: state.setHasMore, prependMessages: state.prependMessages,
    })
    return null
  }
  await act(async () => root.render(React.createElement(Probe)))
  return () => act(async () => root.unmount())
}
it('input-only docks retain send ownership without reading/subscribing/syncing a hidden body', async () => {
  const unmount = await mountHistory(false)
  try {
    expect(useChatStore.getState().sessionId).toBe('session')
    expect(useChatStore.getState().loading).toBe(false)
    expect(fake.readState).not.toHaveBeenCalled()
    expect(fake.readBody).not.toHaveBeenCalled()
    expect(fake.subscribe).not.toHaveBeenCalled()
    expect(fake.sync).not.toHaveBeenCalled()
  } finally { await unmount() }
})
it('actual conversations still load a bounded local window and revalidate', async () => {
  const unmount = await mountHistory(true)
  try {
    expect(fake.readBody).toHaveBeenCalledWith('owner', 'session', { turnLimit: 30, messageLimit: 300 })
    expect(fake.subscribe).toHaveBeenCalled()
    expect(fake.sync).toHaveBeenCalledWith('session')
  } finally { await unmount() }
})
