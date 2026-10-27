// @arch docs/architecture/app/modular-features.md#聊天-feature
// @covers packages/app/src/features/chat/screens/ChatScreenColumn.tsx
// @covers packages/app/src/features/chat/hooks/useChatSessionHistory.ts
// @covers packages/app/src/features/chat/components/ChatHeader.tsx
// @covers packages/app/src/features/desktop-chat/desktopChatHistory.ts

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readDesktopChatHistory } from '../features/desktop-chat/desktopChatHistory'
import type { PersonalSessionBodyMessage } from '../storage/personal-session-body-store.native'

describe('Desktop bounded local history', () => {
  const messages = Array.from({ length: 2400 }, (_, index) => ({
    id: `message-${index + 1}`, role: index === 0 ? 'user' : 'agent', localSequence: index + 1,
  })) as PersonalSessionBodyMessage[]
  function reader() {
    return { getMessages: vi.fn(async (_accountId: string, _sessionId: string,
      options?: { limit?: number; beforeSequence?: number }) => messages
      .filter(message => options?.beforeSequence === undefined || message.localSequence! < options.beforeSequence)
      .slice(-(options?.limit ?? messages.length))) }
  }
  it('reads only 120 records on entry even when one turn has thousands of tool messages', async () => {
    const store = reader()
    const initial = await readDesktopChatHistory(store, 'account', 'session', 30)
    expect(initial).toHaveLength(300)
    expect(initial[0].localSequence).toBe(2101)
    expect(initial.at(-1)?.localSequence).toBe(2400)
    expect(store.getMessages).toHaveBeenCalledOnce()
    expect((await readDesktopChatHistory(store, 'account', 'session', 50))[0].localSequence).toBe(1901)
  })
  it('pages beyond the IPC limit without skipping or duplicating older records', async () => {
    const store = reader()
    const all = await readDesktopChatHistory(store, 'account', 'session', 260)
    expect(all).toEqual(messages)
    expect(store.getMessages.mock.calls.map(call => call[2])).toEqual([
      { limit: 1000, beforeSequence: undefined },
      { limit: 1000, beforeSequence: 1401 },
      { limit: 600, beforeSequence: 401 },
    ])
  })
})

describe('chat background history loading', () => {
  it('renders and pages only from the durable local body replica', () => {
    const column = readFileSync(
      resolve(__dirname, '../features/chat/screens/ChatScreenColumn.tsx'),
      'utf8',
    )
    const historyHook = readFileSync(
      resolve(__dirname, '../features/chat/hooks/useChatSessionHistory.ts'),
      'utf8',
    )
    const screen = readFileSync(
      resolve(__dirname, '../features/chat/screens/ChatScreen.tsx'),
      'utf8',
    )
    const replicaSync = readFileSync(
      resolve(__dirname, '../features/chat/services/personalBodyReplicaSync.native.ts'),
      'utf8',
    )
    expect(column).toContain('loadingOlder={loadingOlder}')
    expect(column).not.toContain('PersonalHistoryStateNotice')
    expect(historyHook).toContain('setLoadingOlder(true)')
    expect(historyHook).toContain('setLoadingOlder(false)')
    expect(historyHook).toContain('personalSessionBodyStore.getMessagesByUserTurns')
    expect(historyHook).toContain('personalSessionBodyStore.subscribe')
    expect(historyHook).not.toContain('getRelayManager')
    expect(historyHook).not.toContain('session.history.open')
    expect(historyHook).not.toContain('session.history.sync')
    expect(historyHook).not.toContain('session.history.page')
    expect(historyHook).not.toContain('session.history.close')
    expect(historyHook).not.toContain('NetInfo')
    expect(replicaSync).not.toContain('useChatStore.subscribe')
    expect(screen).toContain('sendDisabledReason={null}')
    expect(screen).not.toContain("machineOffline\n          ? t('machine_offline')")
    expect(screen).not.toContain('personalHistoryUnavailable')
    expect(historyHook).toContain('acknowledgeLatestSnapshotPresented')
    expect(historyHook).toContain('pendingPresentationTokenRef.current !== presentationToken')
    expect(historyHook).toContain('presentedPresentationTokenRef.current = presentationToken')
    expect(historyHook).toContain('committingPresentationTokenRef.current = presentationToken')
    expect(historyHook).toContain('committingPresentationTokenRef.current) return')
    expect(historyHook).toContain("if (nextState !== 'active') return")
    expect(historyHook).toContain('commitPresentedSnapshotRead(presentationToken)')
    expect(historyHook).toContain('if (chatState.sessionId === sessionId) return')
    expect(historyHook).toContain('loadLocalWindow(loadedTurnsRef.current)')
    expect(column).toContain('onMessagesPresented={onMessagesPresented}')
  })

  it('reconciles a delayed session activity projection after entering from a Room', () => {
    const screen = readFileSync(
      resolve(__dirname, '../features/chat/screens/ChatScreen.tsx'),
      'utf8',
    )

    expect(screen).toContain('if (chatState.sessionId !== sessionId) return')
    expect(screen).toContain('chatState.restoreRunPhase(getSessionLiveActivity(session))')
    expect(screen).toContain('}, [session?.activity, sessionId])')
  })
})

describe('retained chat presentation', () => {
  afterEach(() => {
    vi.doUnmock('react')
    vi.doUnmock('@react-navigation/native')
    vi.doUnmock('@shennian/shared')
    vi.resetModules()
  })

  it('keeps source props isolated while a Worker owns the shared store and through return loading', async () => {
    let focused = true
    let active = true
    let storeSessionId = 'manager-session'
    const retained = { current: null as unknown }
    vi.doMock('react', () => ({
      createContext: <T,>(value: T) => value,
      useContext: () => active,
      useRef: () => retained,
    }))
    vi.doMock('@react-navigation/native', () => ({ useIsFocused: () => focused }))
    vi.doMock('@shennian/shared', () => ({
      useChatStore: (selector: (state: { sessionId: string }) => unknown) =>
        selector({ sessionId: storeSessionId }),
    }))
    const { useRetainedChatPresentation } = await import(
      '../features/chat/hooks/useRetainedChatPresentation'
    )
    const present = (input: { sessionId: string; chatLoading: boolean; body: string }) =>
      useRetainedChatPresentation(input)

    const manager = { sessionId: 'manager-session', chatLoading: false, body: 'manager body' }
    expect(present(manager)).toBe(manager)

    focused = false
    active = false
    storeSessionId = 'worker-session'
    const workerContamination = {
      sessionId: 'manager-session', chatLoading: false, body: 'worker body from singleton store',
    }
    expect(present(workerContamination)).toBe(manager)

    focused = true
    active = true
    storeSessionId = 'manager-session'
    const restoring = { sessionId: 'manager-session', chatLoading: true, body: '' }
    expect(present(restoring)).toBe(manager)

    const restored = { sessionId: 'manager-session', chatLoading: false, body: 'manager body restored' }
    expect(present(restored)).toBe(restored)
  })

  it('drops the retained source immediately when the source Session changes', async () => {
    let focused = true
    let active = true
    let storeSessionId = 'manager-one'
    const retained = { current: null as unknown }
    vi.doMock('react', () => ({
      createContext: <T,>(value: T) => value,
      useContext: () => active,
      useRef: () => retained,
    }))
    vi.doMock('@react-navigation/native', () => ({ useIsFocused: () => focused }))
    vi.doMock('@shennian/shared', () => ({
      useChatStore: (selector: (state: { sessionId: string }) => unknown) =>
        selector({ sessionId: storeSessionId }),
    }))
    const { useRetainedChatPresentation } = await import(
      '../features/chat/hooks/useRetainedChatPresentation'
    )

    const oldSource = { sessionId: 'manager-one', chatLoading: false, body: 'old source' }
    expect(useRetainedChatPresentation(oldSource)).toBe(oldSource)

    focused = false
    active = false
    storeSessionId = 'worker-session'
    const newSource = { sessionId: 'manager-two', chatLoading: true, body: 'new source loading' }
    expect(useRetainedChatPresentation(newSource)).toBe(newSource)
    expect(retained.current).toBeNull()
  })
})
