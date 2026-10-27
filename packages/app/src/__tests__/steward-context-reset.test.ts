// @vitest-environment happy-dom
// @covers packages/app/src/features/steward/useStewardConversation.ts
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const fake = vi.hoisted(() => ({
  primaryLoading: false,
  primaryError: undefined as string | undefined,
  hasSession: true,
  machine: { id: 'm', paired: true, agentList: ['shennian'], agents: [{ type: 'shennian', supportsFreshPersonalContext: true }] },
  old: { id: 'old-main', userId: 'a', machineId: 'm', agentType: 'shennian', sessionScope: 'steward', createdAt: '2026-10-24T00:00:00Z', lastActivityAt: '2026-10-24T00:00:00Z' },
  create: vi.fn(), upsert: vi.fn(), remove: vi.fn(), save: vi.fn(), hydrate: vi.fn(), refresh: vi.fn(), persist: vi.fn(), deleteSession: vi.fn(),
}))
vi.mock('expo-router', async () => { const React = await import('react'); return { useFocusEffect: (callback: () => void | (() => void)) => React.useEffect(callback, [callback]) } })
vi.mock('@shennian/shared', () => ({ useMachinesStore: (select: (s: unknown) => unknown) => select({ machines: [fake.machine] }) }))
vi.mock('../features/personal-workspace/usePrimaryMachine', () => ({ usePrimaryMachine: () => ({ record: { machine: { id: 'm' } }, loading: fake.primaryLoading, error: fake.primaryError }) }))
vi.mock('../config/auth', () => ({ useAuthStore: (select: (s: unknown) => unknown) => select({ user: { id: 'a' } }) }))
vi.mock('../features/account-runtime/accountRuntime', () => ({ accountRuntime: { persistSession: fake.persist, deleteSession: fake.deleteSession } }))
vi.mock('../utils/models', () => ({ getMachineAgentModels: () => [] }))
vi.mock('../features/machines/machineAccountClient', () => ({ machineAccountClient: { createSession: fake.create } }))
vi.mock('../features/sessions/sessionAccountClient', () => ({ sessionAccountClient: {} }))
vi.mock('../features/steward/stewardSessionEvents', () => ({ subscribeStewardResync: () => () => {}, subscribeStewardSessionEvents: () => () => {} }))
vi.mock('../features/steward/stewardSessionsStore', () => ({ useStewardSessionsStore: Object.assign((select: (s: unknown) => unknown) => select({ sessions: fake.hasSession ? [fake.old] : [], hydrated: true, upsert: fake.upsert, remove: fake.remove }), { getState: () => ({ hydrate: fake.hydrate, refresh: fake.refresh }) }) }))
vi.mock('../features/steward/stewardStorage', () => ({
  readStewardPreferences: async () => ({ sessionId: 'old-main' }), readStewardSwitchMarks: async () => [],
  writeStewardPreferences: fake.save, appendStewardSwitchMark: vi.fn(), pruneStewardSwitchMarks: vi.fn(),
}))
import { useStewardConversation } from '../features/steward/useStewardConversation'
let root: Root, host: HTMLDivElement, model: ReturnType<typeof useStewardConversation>
function Probe() { model = useStewardConversation(); return null }
beforeEach(async () => {
  vi.clearAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  fake.machine.agents[0]!.supportsFreshPersonalContext = true
  fake.create.mockResolvedValue({ ...fake.old, id: 'fresh-main', localCreationState: 'draft' })
  fake.save.mockImplementation(async (_account: string, changes: unknown) => changes)
  host = document.createElement('div'); root = createRoot(host)
  await act(async () => root.render(React.createElement(Probe)))
})
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals() })
it('displays the cached conversation while primary routing revalidates in the background', async () => {
  fake.primaryLoading = true
  await act(async () => root.render(React.createElement(Probe)))
  expect(model.status).toBe('ready')
  expect(model.sessionId).toBe('old-main')
  expect(fake.create).not.toHaveBeenCalled()
  fake.primaryLoading = false
})
it('does not create a conversation using unverified cached routing after an offline refresh', async () => {
  fake.hasSession = false
  fake.primaryError = 'request_failed'
  await act(async () => root.render(React.createElement(Probe)))
  expect(fake.create).not.toHaveBeenCalled()
  fake.hasSession = true
  fake.primaryError = undefined
})
it('creates a fresh main session while preserving historical sessions and messages', async () => {
  let ok = false
  await act(async () => { ok = await model.resetContext() })
  expect(ok).toBe(true)
  expect(fake.create).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ machineId: 'm', agentType: 'shennian', sessionScope: 'steward' }))
  expect(fake.save).toHaveBeenCalledWith('a', expect.objectContaining({ sessionId: 'fresh-main' }), true)
  expect(fake.remove).not.toHaveBeenCalled(); expect(fake.deleteSession).not.toHaveBeenCalled()
  expect(model.sessionId).toBe('old-main') // mock store intentionally does not publish upserts
})
it('fails closed on old Clients, and reports failed session creation', async () => {
  fake.machine.agents[0]!.supportsFreshPersonalContext = false
  await act(async () => { expect(await model.resetContext()).toBe(false) })
  expect(fake.create).not.toHaveBeenCalled()
  fake.machine.agents[0]!.supportsFreshPersonalContext = true
  fake.create.mockRejectedValue(new Error('offline'))
  await act(async () => { expect(await model.resetContext()).toBe(false) })
  expect(fake.save).not.toHaveBeenCalled(); expect(fake.deleteSession).not.toHaveBeenCalled()
})
it('does not report success when the selected session cannot be persisted', async () => {
  fake.save.mockRejectedValue(new Error('disk failure'))
  await act(async () => { expect(await model.resetContext()).toBe(false) })
  expect(fake.deleteSession).not.toHaveBeenCalled()
})
