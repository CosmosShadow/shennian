// @covers packages/app/src/features/sessions/contextNewSession.ts

import { describe, expect, it, vi } from 'vitest'
import type { NianSession } from '@shennian/wire'
import {
  handleContextNewSessionShortcut,
  planContextNewSession,
} from '../features/sessions/contextNewSession'
import {
  dispatchShortcutKey,
  registerShortcutHandler,
  resetShortcutHandlersForTest,
} from '../hooks/keyboardShortcuts'

function session(overrides: Partial<NianSession> = {}): NianSession {
  return {
    id: 's1',
    machineId: 'm1',
    userId: 'u1',
    agentType: 'codex',
    agentSessionId: null,
    modelId: 'gpt-5.2',
    title: 'Current',
    status: 'active',
    workDir: '/repo',
    lastActivityAt: '2026-05-28T00:00:00.000Z',
    createdAt: '2026-05-28T00:00:00.000Z',
    updatedAt: '2026-05-28T00:00:00.000Z',
    machineName: 'Mac',
    ...overrides,
  }
}

describe('context new session shortcut', () => {
  it('creates a new session with the current session machine, workDir, and model', async () => {
    const created = session({ id: 's2', title: 'New' })
    const createSession = vi.fn(async () => created)
    const openFullFlow = vi.fn()
    const persistSession = vi.fn()
    const upsertSession = vi.fn()
    const navigateToSession = vi.fn()

    const plan = await handleContextNewSessionShortcut({
      pathname: '/(main)/chat/s1',
      sessions: [session()],
      hasOpenModal: false,
      createSession,
      openFullFlow,
      persistSession,
      upsertSession,
      navigateToSession,
    })

    expect(plan.kind).toBe('create')
    expect(createSession).toHaveBeenCalledWith({
      machineId: 'm1',
      agentType: 'codex',
      workDir: '/repo',
      modelId: 'gpt-5.2',
    })
    expect(openFullFlow).not.toHaveBeenCalled()
    expect(persistSession).toHaveBeenCalledWith(created)
    expect(upsertSession).toHaveBeenCalledWith(created)
    expect(navigateToSession).toHaveBeenCalledWith('s2')
  })

  it('opens the full new-session flow when current context is missing', async () => {
    const createSession = vi.fn()
    const openFullFlow = vi.fn()

    const plan = await handleContextNewSessionShortcut({
      pathname: '/(main)/chat/s1',
      sessions: [session({ modelId: null })],
      hasOpenModal: false,
      createSession,
      openFullFlow,
      upsertSession: vi.fn(),
      navigateToSession: vi.fn(),
    })

    expect(plan).toEqual({ kind: 'openFullFlow', reason: 'missing-context' })
    expect(openFullFlow).toHaveBeenCalledTimes(1)
    expect(createSession).not.toHaveBeenCalled()
  })

  it('opens the full new-session flow when no session is selected', async () => {
    const createSession = vi.fn()
    const openFullFlow = vi.fn()

    const plan = await handleContextNewSessionShortcut({
      pathname: '/(main)',
      sessions: [session()],
      hasOpenModal: false,
      createSession,
      openFullFlow,
      upsertSession: vi.fn(),
      navigateToSession: vi.fn(),
    })

    expect(plan).toEqual({ kind: 'openFullFlow', reason: 'no-current-session' })
    expect(openFullFlow).toHaveBeenCalledTimes(1)
    expect(createSession).not.toHaveBeenCalled()
  })

  it('blocks instead of replacing modal form contents when a modal is open', () => {
    expect(
      planContextNewSession({
        pathname: '/(main)/chat/s1',
        sessions: [session()],
        hasOpenModal: true,
      }),
    ).toEqual({ kind: 'blocked-by-modal' })
  })

  it('never creates or opens a global flow from the Desktop shortcut', async () => {
    const createSession = vi.fn()
    const openFullFlow = vi.fn()

    const plan = await handleContextNewSessionShortcut({
      pathname: '/(main)/chat/s1',
      sessions: [session()],
      hasOpenModal: false,
      desktopControlSurface: true,
      createSession,
      openFullFlow,
      upsertSession: vi.fn(),
      navigateToSession: vi.fn(),
    })

    expect(plan).toEqual({ kind: 'blocked-by-desktop-policy' })
    expect(createSession).not.toHaveBeenCalled()
    expect(openFullFlow).not.toHaveBeenCalled()
  })

  it('prevents the browser default new window for command/control N', () => {
    resetShortcutHandlersForTest()
    const calls: string[] = []
    registerShortcutHandler({ key: 'n', metaOrCtrl: true, allowEditable: true }, () =>
      calls.push('new'),
    )
    const event = {
      key: 'n',
      metaKey: true,
      target: { tagName: 'INPUT' },
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    }

    expect(dispatchShortcutKey(event)).toBe(true)
    expect(calls).toEqual(['new'])
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(event.stopPropagation).toHaveBeenCalledTimes(1)
    resetShortcutHandlersForTest()
  })
})
