// @vitest-environment happy-dom
// @covers packages/app/src/features/steward/components/PersonalModelSettings.tsx
// @covers packages/app/src/features/steward/components/PersonalModelAllowance.tsx
// @covers packages/app/src/features/steward/StewardModelScreen.tsx
// @covers packages/app/src/features/steward/StewardWorkerSettingsScreen.tsx
// @covers packages/app/src/features/steward/components/StewardConversationActions.tsx
// @covers packages/app/src/features/steward/StewardSettingsScreen.tsx
// @covers packages/app/src/features/steward/StewardSessionsScreen.tsx
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ alert: vi.fn(), reset: vi.fn(), clear: vi.fn(), workerRead: vi.fn(), workerSave: vi.fn(), quota: vi.fn(), read: vi.fn(), save: vi.fn(), revision: 4, accountId: 'a', navigate: vi.fn(), push: vi.fn(), remember: vi.fn() }))
vi.mock('react-native', () => ({
  Alert: { alert: state.alert },
  Platform: { OS: 'ios' },
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  View: ({ children, testID }: { children: React.ReactNode; testID?: string }) => React.createElement('div', { 'data-testid': testID }, children),
  ScrollView: ({ children }: { children: React.ReactNode }) => React.createElement('main', null, children),
  Text: ({ children, testID }: { children: React.ReactNode; testID?: string }) => React.createElement('span', { 'data-testid': testID }, children),
  ActivityIndicator: () => null,
  Pressable: ({ children, onPress, disabled, testID }: { children: React.ReactNode; onPress: () => void; disabled: boolean; testID: string }) => React.createElement('button', { onClick: onPress, disabled, 'data-testid': testID }, children),
  TextInput: ({ value, onChangeText, testID, secureTextEntry }: { value: string; onChangeText: (value: string) => void; testID: string; secureTextEntry: boolean }) => React.createElement('input', { value, type: secureTextEntry ? 'password' : 'text', onInput: (e: React.FormEvent<HTMLInputElement>) => onChangeText(e.currentTarget.value), 'data-testid': testID }),
  Switch: ({ testID, style, value, onValueChange }: { testID?: string; style?: React.CSSProperties; value: boolean; onValueChange: (value: boolean) => void }) => React.createElement('input', { type: 'checkbox', role: 'switch', 'data-testid': testID, style: { alignSelf: 'flex-start', ...style }, checked: value, onChange: (event: React.ChangeEvent<HTMLInputElement>) => onValueChange(event.currentTarget.checked) }),
}))
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children, testID }: { children: React.ReactNode; testID?: string }) => React.createElement('div', { 'data-testid': testID }, children) }))
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: () => null }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, params?: Record<string, unknown>) => params ? `${key} ${Object.values(params).join(' ')}` : key }) }))
vi.mock('expo-router', () => ({ useRouter: () => ({ navigate: state.navigate, push: state.push, back: vi.fn() }), Redirect: ({ href }: { href: string }) => React.createElement('div', { 'data-redirect': href }) }))
vi.mock('../hooks/useTheme', () => ({ useTheme: () => ({ colors: {} }) }))
vi.mock('../components/AppPageHeader', () => ({ AppPageHeader: () => null }))
vi.mock('../config/auth', () => ({ useAuthStore: Object.assign((select: (value: unknown) => unknown) => select({ user: { id: state.accountId } }), { getState: () => ({ user: { id: state.accountId } }) }) }))
vi.mock('../features/personal-workspace/usePrimaryMachine', () => ({ usePrimaryMachine: () => ({ record: { revision: state.revision, machine: { id: 'm' } }, loading: false }) }))
vi.mock('../features/steward/useStewardConversation', () => ({ useStewardConversation: () => ({ machine: { id: 'm', name: 'QA' }, remember: state.remember, showMachineName: true }) }))
vi.mock('../features/schedules/ConversationSchedules', () => ({ ConversationSchedules: () => null }))
vi.mock('../features/steward/personalModelClient', () => ({ personalModelClient: { quota: state.quota, read: state.read, save: state.save } }))
import { PersonalModelAllowance } from '../features/steward/components/PersonalModelAllowance'
vi.mock('../features/steward/personalWorkerClient', () => ({ personalWorkerClient: { read: state.workerRead, save: state.workerSave } }))
import { StewardModelScreen } from '../features/steward/StewardModelScreen'
import { StewardWorkerSettingsScreen } from '../features/steward/StewardWorkerSettingsScreen'
import { PersonalModelSettings } from '../features/steward/components/PersonalModelSettings'
import { StewardConversationActions } from '../features/steward/components/StewardConversationActions'
import { StewardSettingsScreen } from '../features/steward/StewardSettingsScreen'
import { StewardSessionsScreen } from '../features/steward/StewardSessionsScreen'
let root: Root, host: HTMLDivElement
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  state.accountId = 'a'; state.revision = 4
  state.quota.mockResolvedValue({ limit: 5000000, used: 1000000, outputWeight: 4, remaining: 4000000, resetsAt: '2026-11-01T00:00:00.000Z' })
  state.workerRead.mockResolvedValue({ agentType: 'shennian', modelId: null, defaultWorkDir: '/agent', agents: [] })
  state.read.mockResolvedValue({ mode: 'official', model: 'official', baseUrl: '', hasApiKey: false, contextWindow: 1000000 })
  state.save.mockResolvedValue({ mode: 'custom', model: 'my-model', baseUrl: 'https://provider.example/v1', contextWindow: 1000000, hasApiKey: true })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
async function render(element: React.ReactNode = React.createElement(PersonalModelSettings)) { await act(async () => { root.render(element); await Promise.resolve() }) }
async function click(id: string) { await act(async () => { host.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!.click(); await Promise.resolve() }) }
async function fill(id: string, value: string) { await act(async () => { const input = host.querySelector<HTMLInputElement>(`[data-testid="${id}"]`)!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) }) }
describe('continuous personal Agent settings', () => {
  it('centers the machine-name switch instead of the iOS default top alignment and saves changes', async () => {
    await render(React.createElement(StewardSettingsScreen))
    const toggle = host.querySelector<HTMLInputElement>('[data-testid="steward-toggle-machine-name"]')!
    expect(toggle.style.alignSelf).toBe('center')
    expect(toggle.checked).toBe(true)
    await act(async () => toggle.click())
    expect(state.remember).toHaveBeenCalledExactlyOnceWith({ showMachineName: false })
  })
  it('defaults to official, saves custom configuration to the bound computer and clears the password', async () => {
    await render(); expect(host.querySelector('[data-testid="personal-model-key"]')).toBeNull()
    await click('personal-model-mode-custom')
    expect(host.querySelector('[data-testid="personal-model-name"]')).toBeNull()
    await fill('personal-model-url', 'https://provider.example/v1'); await fill('personal-model-key', 'synthetic-key')
    expect(host.querySelector<HTMLInputElement>('[data-testid="personal-model-key"]')!.type).toBe('password')
    await click('personal-model-save')
    expect(state.save).toHaveBeenCalledExactlyOnceWith(4, { mode: 'custom', baseUrl: 'https://provider.example/v1', apiKey: 'synthetic-key', contextWindow: 1000000 })
    expect(host.querySelector<HTMLInputElement>('[data-testid="personal-model-key"]')!.value).toBe('')
    expect(host.textContent?.includes('personal_model_saved')).toBe(true)
  })
  it('uses provider presets without asking for a model ID and requires a replacement key on a new host', async () => {
    state.read.mockResolvedValue({ mode: 'custom', model: 'saved-model', baseUrl: 'https://provider.example/v1', hasApiKey: true, contextWindow: 32768 })
    await render()
    await click('personal-model-provider-deepseek')
    expect(host.querySelector<HTMLInputElement>('[data-testid="personal-model-url"]')!.value).toBe('https://api.deepseek.com')
    expect(host.querySelector('[data-testid="personal-model-name"]')).toBeNull()
    await click('personal-model-save'); expect(state.save).not.toHaveBeenCalled()
    await fill('personal-model-key', 'synthetic-new-key'); await click('personal-model-save')
    expect(state.save).toHaveBeenCalledWith(4, { mode: 'custom', baseUrl: 'https://api.deepseek.com', apiKey: 'synthetic-new-key', contextWindow: 32768 })
  })
  it('leaves a saved key untouched when blank, switches back to official, and shows save errors', async () => {
    state.read.mockResolvedValue({ mode: 'custom', model: 'saved-model', baseUrl: 'https://provider.example/v1', hasApiKey: true, contextWindow: 32768 })
    await render(); await click('personal-model-save')
    expect(state.save.mock.calls[0]?.[1]).not.toHaveProperty('apiKey')
    state.save.mockRejectedValue(new Error('secret-provider-diagnostic'))
    await click('personal-model-mode-official'); await click('personal-model-save')
    expect(state.save.mock.calls[1]?.[1]).toEqual({ mode: 'official' })
    expect(host.textContent?.includes('personal_model_unavailable')).toBe(true); expect(host.textContent?.includes('secret-provider-diagnostic')).toBe(false)
  })
  it('removes session and AI tool management and redirects old history links without deleting anything', async () => {
    await render(React.createElement(StewardSettingsScreen))
    expect(host.querySelector('[data-testid="personal-model-settings"]')).toBeNull()
    await click('steward-model')
    expect(state.navigate).toHaveBeenCalledWith('/(main)/steward-model')
    await click('steward-background-agent')
    expect(state.navigate).toHaveBeenCalledWith('/(main)/steward-background-agent')
    await click('steward-primary-computer')
    expect(state.navigate).toHaveBeenCalledWith('/(main)/primary-computer')
    expect(host.textContent).not.toContain('personal_model_continuous_hint')
    expect(host.querySelector('[data-testid="steward-settings-sessions"]')).toBeNull()
    expect(host.querySelector('[data-testid="steward-settings-new"]')).toBeNull()
    expect(host.querySelector('[data-testid="steward-settings-clear"]')).toBeNull()
    expect(host.querySelector('[data-testid="steward-row-tool"]')).toBeNull()
    await render(React.createElement(StewardSessionsScreen))
    expect(host.querySelector('[data-redirect]')?.getAttribute('data-redirect')).toBe('/(main)/steward-settings')
  })
})

it('shows account allowance without a primary computer and refreshes zero remaining accurately', async () => {
  await render(React.createElement(PersonalModelAllowance, { mode: 'official' }))
  expect(state.read).not.toHaveBeenCalled()
  expect(host.textContent).toContain('4,000,000')
  state.quota.mockResolvedValue({ limit: 5000000, remaining: 0, used: 5000000, outputWeight: 4, resetsAt: '2026-11-01T00:00:00Z' })
  await click('personal-model-quota-refresh')
  expect(host.querySelector('[data-testid="personal-model-quota-value"]')?.textContent).toBe('personal_model_quota_units 0')
})
it('only shows unlimited on an explicit server response, and does not infer it from own models or failures', async () => {
  state.quota.mockResolvedValue({ unlimited: true, limit: null, remaining: null })
  await render(React.createElement(PersonalModelAllowance, { mode: 'custom' }))
  expect(host.textContent).toContain('personal_model_quota_unlimited')
  expect(host.textContent).toContain('personal_model_quota_custom')
  state.quota.mockRejectedValue(new Error('private backend diagnostic'))
  await click('personal-model-quota-refresh')
  expect(host.textContent).toContain('personal_model_quota_unavailable')
  expect(host.textContent).not.toContain('personal_model_quota_unlimited')
  expect(host.textContent).not.toContain('private backend diagnostic')
  state.quota.mockResolvedValue({ limit: null, remaining: null })
  await click('personal-model-quota-refresh')
  expect(host.textContent).toContain('personal_model_quota_unavailable')
})
it('discards allowance responses from a previous account', async () => {
  let resolve!: (v: unknown) => void
  state.quota.mockReturnValueOnce(new Promise(r => { resolve = r }))
  await render(React.createElement(PersonalModelAllowance, { mode: 'official' }))
  state.accountId = 'b'
  await render(React.createElement(PersonalModelAllowance, { mode: 'official' }))
  await act(async () => resolve({ unlimited: true, limit: null, remaining: null }))
  expect(host.textContent).not.toContain('personal_model_quota_unlimited')
  expect(host.textContent).toContain('4,000,000')
})

it('keeps main Agent and background Agent configuration on separate pages', async () => {
  await render(React.createElement(StewardModelScreen))
  expect(host.querySelector('[data-testid="personal-model-settings"]')).not.toBeNull()
  expect(host.querySelector('[data-testid="personal-worker-settings"]')).toBeNull()
  expect(state.workerRead).not.toHaveBeenCalled()
  await render(React.createElement(StewardWorkerSettingsScreen))
  expect(host.querySelector('[data-testid="personal-model-settings"]')).toBeNull()
  expect(host.querySelector('[data-testid="personal-worker-settings"]')).not.toBeNull()
  expect(state.workerRead).toHaveBeenCalledExactlyOnceWith(4)
})


it('opens memory and AI scheduled tasks directly from steward settings without an all-features entry', async () => {
  await render(React.createElement(StewardSettingsScreen))
  await click('steward-settings-memory')
  expect(state.push).toHaveBeenCalledWith({ pathname: '/(main)/personal-workspace', params: { kind: 'memory', __mobileEntry: 'push' } })
  await click('steward-settings-scheduledTasks')
  expect(state.push).toHaveBeenCalledWith({ pathname: '/(main)/scheduled-tasks', params: { __mobileEntry: 'push' } })
  expect(host.textContent).not.toContain('mobile_all_features')
})

describe('independent main Agent conversation actions', () => {
  async function actions(canReset = true, available = true) {
    await render(React.createElement(StewardConversationActions, { available, canReset, resetContext: state.reset, clearDisplay: state.clear }))
    await click('steward-conversation-settings')
  }
  async function accept() {
    const buttons = state.alert.mock.calls.at(-1)![2] as Array<{ onPress?: () => void }>
    await act(async () => { buttons[1]!.onPress!(); await Promise.resolve() })
  }
  it('starts collapsed, exposes two explicit actions on expansion, and collapses without running them', async () => {
    await render(React.createElement(StewardConversationActions, { available: true, canReset: true, resetContext: state.reset, clearDisplay: state.clear }))
    expect(host.querySelector('[data-testid="steward-action-reset"]')).toBeNull()
    expect(host.querySelector('[data-testid="steward-action-display"]')).toBeNull()
    await click('steward-conversation-settings')
    expect(host.querySelector('[data-testid="steward-action-reset"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="steward-action-display"]')).not.toBeNull()
    await click('steward-conversation-settings')
    expect(host.querySelector('[data-testid="steward-action-reset"]')).toBeNull()
    expect(state.alert).not.toHaveBeenCalled()
    expect(state.reset).not.toHaveBeenCalled()
    expect(state.clear).not.toHaveBeenCalled()
  })
  it('does nothing until confirmation, then only resets main context', async () => {
    state.reset.mockResolvedValue(true)
    await actions(); await click('steward-action-reset')
    expect(state.reset).not.toHaveBeenCalled(); expect(state.clear).not.toHaveBeenCalled()
    expect(state.alert.mock.calls[0]![1]).toBe('steward_action_reset_confirm')
    await accept()
    expect(state.reset).toHaveBeenCalledOnce(); expect(state.clear).not.toHaveBeenCalled()
    expect(host.textContent).toContain('steward_action_reset_done')
  })
  it('clears display independently, and reports persistence failures without claiming success', async () => {
    state.clear.mockRejectedValueOnce(new Error('private-storage-error')).mockResolvedValue(undefined)
    await actions(); await click('steward-action-display'); await accept()
    expect(host.textContent).toContain('steward_action_failed')
    expect(host.textContent).not.toContain('private-storage-error')
    await click('steward-action-display'); await accept()
    expect(host.textContent).toContain('steward_action_display_done')
    expect(state.reset).not.toHaveBeenCalled()
  })
  it('requires fresh-context support only for resetting, not display clearing', async () => {
    await actions(false); await click('steward-action-reset')
    expect(state.alert.mock.calls[0]![1]).toBe('steward_action_reset_upgrade')
    expect(state.reset).not.toHaveBeenCalled()
    await click('steward-action-display')
    expect(state.alert.mock.calls.at(-1)![1]).toBe('steward_action_display_confirm')
  })
  it('prevents double confirmations and reports reset failure', async () => {
    let resolve!: (ok: boolean) => void
    state.reset.mockReturnValue(new Promise<boolean>(done => { resolve = done }))
    await actions(); await click('steward-action-reset')
    const confirm = state.alert.mock.calls[0]![2][1].onPress
    await act(async () => { confirm(); confirm() })
    expect(state.reset).toHaveBeenCalledOnce()
    expect(host.querySelector<HTMLButtonElement>('[data-testid="steward-action-display"]')!.disabled).toBe(true)
    await act(async () => resolve(false))
    expect(host.textContent).toContain('steward_action_failed')
  })
  it('disables actions before a primary conversation is ready', async () => {
    await actions(true, false); await click('steward-action-reset'); await click('steward-action-display')
    expect(state.alert).not.toHaveBeenCalled()
  })
})
