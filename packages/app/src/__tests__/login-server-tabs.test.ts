// @vitest-environment happy-dom
// @arch docs/features/self-hosted-instances.md
// @covers packages/app/src/features/auth/components/SelfHostedLoginPanel.tsx
import React, { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Colors } from '../hooks/useTheme'
const mock = vi.hoisted(() => ({ select: vi.fn(), manual: false, ready: vi.fn() }))
vi.mock('react-native', () => ({
  View: ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children),
  Text: ({ children }: { children?: React.ReactNode }) => React.createElement('span', null, children),
  ActivityIndicator: () => React.createElement('span', null, 'busy'),
  Pressable: ({ children, onPress, disabled, testID, accessibilityState }: { children?: React.ReactNode; onPress: () => void; disabled?: boolean; testID: string; accessibilityState?: { selected?: boolean } }) => React.createElement('button', { 'data-testid': testID, disabled, 'aria-selected': accessibilityState?.selected, onClick: onPress }, children),
  TextInput: ({ value, onChangeText, testID, editable }: { value: string; onChangeText: (value: string) => void; testID: string; editable?: boolean }) => React.createElement('input', { 'data-testid': testID, value, disabled: editable === false, onInput: (event: React.FormEvent<HTMLInputElement>) => onChangeText(event.currentTarget.value) }),
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('expo-router', () => ({ useRouter: () => ({ replace: vi.fn() }) }))
vi.mock('../config/server', () => ({ getServerUrl: () => 'https://company.test', isSelfHostedSelection: () => mock.manual, selectLoginServer: mock.select, beginLoginServerUse: () => vi.fn() }))
vi.mock('../config/auth', () => ({ useAuthStore: { getState: () => ({ token: null, refreshToken: null }) } }))
vi.mock('../config/api', () => ({ api: vi.fn() }))
vi.mock('../features/auth/utils/installation', () => ({ getAuthDeviceMetadata: vi.fn() }))
import { ServerSelector, type LoginServerMode } from '../features/auth/components/SelfHostedLoginPanel'
let host: HTMLDivElement, root: Root
const colors = {} as Colors
function Harness({ initial = 'cloud' }: { initial?: LoginServerMode }) {
  const [mode, setMode] = useState(initial)
  return React.createElement(ServerSelector, { colors, mode, onModeChange: setMode, onReadyChange: mock.ready })
}
const get = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mock.manual = false; mock.select.mockReset(); mock.ready.mockReset()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })
describe('login server tabs', () => {
  it('shows two tabs and opens address entry without changing the active server', async () => {
    await act(async () => root.render(React.createElement(Harness)))
    expect(get('server-tab-cloud').getAttribute('aria-selected')).toBe('true')
    expect(get('server-address-input')).toBeNull()
    await act(async () => get('server-tab-self-hosted').click())
    expect(get('server-tab-self-hosted').getAttribute('aria-selected')).toBe('true')
    expect(get('server-address-input')).not.toBeNull()
    expect(get('server-connect').disabled).toBe(true)
    expect(mock.select).not.toHaveBeenCalled()
  })
  it('invalidates login readiness on address edits and only enables it after connection', async () => {
    await act(async () => root.render(React.createElement(Harness, { initial: 'self-hosted' })))
    await act(async () => { const input = get('server-address-input') as unknown as HTMLInputElement; input.value = 'company.test'; input.dispatchEvent(new Event('input', { bubbles: true })) })
    expect(mock.ready).toHaveBeenLastCalledWith(false)
    await act(async () => get('server-connect').click())
    expect(mock.select).toHaveBeenCalledWith('company.test')
    expect(mock.ready).toHaveBeenLastCalledWith(true)
  })
  it('keeps failed cloud switches on the self-hosted tab with an error', async () => {
    mock.manual = true; mock.select.mockRejectedValueOnce(new Error('instance_already_bound'))
    await act(async () => root.render(React.createElement(Harness, { initial: 'self-hosted' })))
    await act(async () => get('server-tab-cloud').click())
    expect(mock.select).toHaveBeenCalledWith(null)
    expect(get('server-tab-self-hosted').getAttribute('aria-selected')).toBe('true')
    expect(host.textContent).toContain('selfhost_connection_error')
  })
  it('switches back to cloud only after the origin selection succeeds', async () => {
    mock.manual = true
    let complete!: () => void
    mock.select.mockImplementationOnce(() => new Promise<void>(resolve => { complete = resolve }))
    await act(async () => root.render(React.createElement(Harness, { initial: 'self-hosted' })))
    await act(async () => get('server-tab-cloud').click())
    expect(get('server-tab-self-hosted').getAttribute('aria-selected')).toBe('true')
    expect(get('server-tab-cloud').disabled).toBe(true)
    await act(async () => complete())
    expect(mock.select).toHaveBeenCalledWith(null)
    expect(get('server-tab-cloud').getAttribute('aria-selected')).toBe('true')
    expect(get('server-address-input')).toBeNull()
  })
})
