// @vitest-environment happy-dom
// @covers packages/app/src/features/steward/components/PersonalWorkerSettings.tsx
// @covers packages/app/src/features/steward/personalWorkerClient.ts
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), revision: 4, accountId: 'a', machine: 'm' }))
vi.mock('react-native', () => ({ StyleSheet: { create: (s: unknown) => s },
  View: ({ children, testID }: any) => React.createElement('div', { 'data-testid': testID }, children),
  Text: ({ children }: any) => React.createElement('span', null, children), ActivityIndicator: () => null, TextInput: ({ testID, value, onChangeText, editable }: any) => React.createElement('input', { 'data-testid': testID, value, disabled: !editable, onChange: (e: any) => onChangeText(e.target.value) }),
  Pressable: ({ children, onPress, disabled, testID }: any) => React.createElement('button', { onClick: onPress, disabled, 'data-testid': testID }, children),
}))
vi.mock('../components/ChoiceChip', () => ({ ChoiceChip: ({ label, onPress, disabled, testID, selected }: any) => React.createElement('button', { onClick: onPress, disabled, 'data-testid': testID, 'aria-checked': selected }, label) }))
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: () => null }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../hooks/useTheme', () => ({ useTheme: () => ({ colors: {} }) }))
vi.mock('../config/auth', () => ({ useAuthStore: Object.assign((select: any) => select({ user: { id: state.accountId } }), { getState: () => ({ user: { id: state.accountId } }) }) }))
vi.mock('../features/personal-workspace/usePrimaryMachine', () => ({ usePrimaryMachine: () => ({ record: { revision: state.revision, machine: { id: state.machine } } }) }))
vi.mock('../features/steward/personalWorkerClient', () => ({ personalWorkerClient: { read: state.read, save: state.save } }))
import { PersonalWorkerSettings } from '../features/steward/components/PersonalWorkerSettings'
let root: Root, host: HTMLDivElement
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  state.accountId = 'a'; state.machine = 'm'; state.revision = 4
  state.read.mockResolvedValue({ agentType: 'codex', modelId: null, workDir: '/legacy-worker-directory', defaultWorkDir: '/agent', agents: [{ type: 'codex', models: [{ id: 'm1', name: 'Model 1' }] }, { type: 'claude', models: [] }] })
  state.save.mockImplementation(async (_revision, value) => value)
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
async function render() { await act(async () => { root.render(React.createElement(PersonalWorkerSettings)); await Promise.resolve() }) }
async function click(id: string) { await act(async () => { host.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!.click(); await Promise.resolve() }) }
it('loads real available Workers, saves to the bound primary and can clear defaults', async () => {
  await render(); expect(state.read).toHaveBeenCalledExactlyOnceWith(4)
  expect(host.querySelector('input')).toBeNull()
  expect(host.textContent).not.toContain('/legacy-worker-directory')
  await click('personal-worker-claude'); await click('personal-worker-save')
  expect(state.save).toHaveBeenLastCalledWith(4, { agentType: 'claude', modelId: null, workDir: null })
  expect(host.textContent).toContain('personal_worker_saved')
  await click('personal-worker-official'); await click('personal-worker-save')
  expect(state.save).toHaveBeenLastCalledWith(4, { agentType: 'shennian', modelId: null, workDir: null })
})
it('disables saving for an old/offline Client and does not claim success', async () => {
  state.read.mockRejectedValue(new Error('old client')); await render()
  expect(host.textContent).toContain('personal_worker_unavailable')
  expect(host.querySelector<HTMLButtonElement>('[data-testid="personal-worker-save"]')!.disabled).toBe(true)
  expect(state.save).not.toHaveBeenCalled()
})
it('discards stale responses after switching account or primary computer', async () => {
  let resolve!: (value: unknown) => void
  state.read.mockReturnValueOnce(new Promise(r => { resolve = r }))
  await render()
  state.accountId = 'b'; state.machine = 'other'; state.revision = 9; await render()
  await act(async () => resolve({ agentType: 'gemini', modelId: null, agents: [{ type: 'gemini', models: [] }] }))
  expect(host.querySelector('[data-testid="personal-worker-gemini"]')).toBeNull()
  await click('personal-worker-save')
  expect(state.save).toHaveBeenCalledExactlyOnceWith(9, { agentType: 'codex', modelId: null, workDir: null })
})

it('shows background Agent settings directly and exposes custom Agents only on request', async () => {
  await render()
  expect(state.read).toHaveBeenCalledExactlyOnceWith(4)
  expect(host.querySelector('[data-testid="personal-worker-save"]')).not.toBeNull()
  expect(host.querySelector('[data-testid="personal-worker-advanced"]')).toBeNull()
  await click('personal-worker-official')
  expect(host.querySelector('[data-testid="personal-worker-claude"]')).toBeNull()
  await click('personal-worker-custom')
  expect(host.querySelector('[data-testid="personal-worker-claude"]')).not.toBeNull()
})
