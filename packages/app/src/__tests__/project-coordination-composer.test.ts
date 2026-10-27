// @vitest-environment happy-dom
// @covers packages/app/src/features/projects/coordination/ProjectCoordinationComposer.tsx
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, expect, it, vi } from 'vitest'
const fixture = vi.hoisted(() => ({ voice: {} as any, input: {} as any, consent: vi.fn(), request: vi.fn(), push: vi.fn() }))
vi.mock('react-native', () => ({ Alert: { alert: vi.fn() }, Platform: { OS: 'ios' }, Switch: () => null, StyleSheet: { create: (v: unknown) => v }, View: ({ children }: any) => React.createElement('div', null, children), Text: ({ children }: any) => React.createElement('span', null, children), Pressable: ({ children, onPress }: any) => React.createElement('button', { onClick: onPress }, children), TextInput: (props: any) => { fixture.input = props; return React.createElement('textarea', { value: props.value, readOnly: true }) } }))
vi.mock('../features/chat/components/ComposerIconButton', () => ({ ComposerIconButton: ({ onPress, disabled, accessibilityLabel }: any) => React.createElement('button', { disabled, 'aria-label': accessibilityLabel, onClick: onPress }, 'send') }))
vi.mock('../features/chat/components/ComposerVoiceControl', () => ({ ComposerVoiceControl: () => React.createElement('button', null, 'voice') }))
vi.mock('../features/chat/hooks/useVoiceDraft', () => ({ useVoiceDraft: (options: any) => { fixture.voice = options; return { phase: 'idle' } } }))
vi.mock('../features/chat/hooks/useChatUploads', () => ({ useChatUploads: () => ({ pendingAttachments: [], isUploading: false, clearPendingAttachments: vi.fn() }) }))
vi.mock('../features/privacy/useAiDataConsent', () => ({ usePersonalAiDataConsent: () => fixture.consent }))
vi.mock('../features/projects/coordination/client', () => ({ projectCoordinationRequest: fixture.request }))
vi.mock('@react-navigation/native', () => ({ useIsFocused: () => true }))
vi.mock('@expo/vector-icons/Feather', () => ({ default: () => null }))
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: () => null }))
vi.mock('expo-crypto', () => ({ randomUUID: () => 'stable-send-id' }))
vi.mock('expo-router', () => ({ useRouter: () => ({ push: fixture.push }) }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../hooks/useTheme', () => ({ useTheme: () => ({ colors: {} }) }))
vi.mock('../config/auth', () => ({ useAuthStore: (select: any) => select({ user: { id: 'unit' } }) }))
import { ProjectCoordinationComposer } from '../features/projects/coordination/ProjectCoordinationComposer'
beforeEach(() => { vi.clearAllMocks(); fixture.consent.mockResolvedValue(true); fixture.request.mockResolvedValue({}) })
async function mount() { const host = document.createElement('div'), root = createRoot(host); await act(async () => root.render(React.createElement(ProjectCoordinationComposer, { machineId: 'machine', workDir: '/qa-project' }))); await act(async () => fixture.input.onChangeText('验收草稿')); return { host, root } }
it('retains the draft and sends no project data when AI consent is declined', async () => {
  fixture.consent.mockResolvedValue(false)
  const { host, root } = await mount()
  await act(async () => (host.querySelector('[aria-label=send]') as HTMLButtonElement).click())
  expect(fixture.request).not.toHaveBeenCalled()
  expect(fixture.input.value).toBe('验收草稿')
  await act(async () => root.unmount())
})
it('keeps a failed draft and retries the same receipt before clearing and opening the coordinator', async () => {
  fixture.request.mockRejectedValueOnce(new Error('offline'))
  const { host, root } = await mount()
  await act(async () => (host.querySelector('[aria-label=send]') as HTMLButtonElement).click())
  expect(fixture.input.value).toBe('验收草稿')
  await act(async () => (host.querySelector('[aria-label=send]') as HTMLButtonElement).click())
  expect(fixture.request.mock.calls.map(call => call[2].requestId)).toEqual(['stable-send-id', 'stable-send-id'])
  expect(fixture.input.value).toBe('')
  expect(fixture.push).toHaveBeenCalledWith({ pathname: '/(main)/project-coordination', params: { machineId: 'machine', workDir: '/qa-project' } })
  await act(async () => root.unmount())
})

it('uses a scoped recognition context and inserts dictation into the existing project send flow', async () => {
  const { host, root } = await mount()
  expect(fixture.voice.sessionId).toBe('project-coordination:unit:machine:/qa-project')
  expect(fixture.voice.active).toBe(true)
  expect(fixture.voice.sessionDraftEnabled).toBe(false)
  await act(async () => fixture.voice.onDraftReady({ draft: '项目口述' }))
  expect(fixture.input.value).toBe('项目口述')
  expect(fixture.request).not.toHaveBeenCalled()
  await act(async () => (host.querySelector('[aria-label=send]') as HTMLButtonElement).click())
  expect(fixture.request).toHaveBeenCalledWith('machine', '/qa-project', expect.objectContaining({ text: '项目口述' }))
  await act(async () => root.unmount())
})
