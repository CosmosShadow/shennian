// @covers packages/app/src/features/personal-modules/confirmRecordingStart.ts
// @covers packages/app/src/features/privacy/aiDataConsent.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  alert: vi.fn(), showConsent: vi.fn(), start: vi.fn(), target: vi.fn(),
  account: 'account-a' as string | undefined,
  state: { error: null as string | null, active: false },
}))
vi.mock('react-native', () => ({ Alert: { alert: mocks.alert }, Platform: { OS: 'web' } }))
vi.mock('../config/auth', () => ({
  useAuthStore: { getState: () => ({ user: mocks.account ? { id: mocks.account } : null }) },
}))
vi.mock('../config/i18n', () => ({ default: { t: (key: string) => key } }))
vi.mock('../config/server', () => ({ PUBLIC_SITE_URL: 'https://shennian.net' }))
vi.mock('../features/privacy/webAiDataConsent', () => ({ showWebAiDataConsent: mocks.showConsent }))
vi.mock('../features/personal-modules/audioArchive', () => ({ currentRecordingTarget: mocks.target }))
vi.mock('../features/personal-modules/runtime', () => ({
  moduleStore: async () => ({ cached: async () => null }),
  startRecording: mocks.start,
  useRecordingState: { getState: () => mocks.state },
}))

import { confirmRecordingStart } from '../features/personal-modules/confirmRecordingStart'
import { revokeAiDataConsents } from '../features/privacy/aiDataConsent'

beforeEach(() => {
  vi.clearAllMocks()
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  } })
  mocks.account = 'account-a'
  mocks.state = { error: null, active: false }
  mocks.target.mockResolvedValue({ machineId: 'mac', revision: 1 })
  mocks.showConsent.mockResolvedValue(true)
  mocks.start.mockResolvedValue(undefined)
})

describe('recording first-use confirmation', () => {
  it('asks once, then starts directly with the freshly resolved target', async () => {
    await confirmRecordingStart()
    mocks.target.mockResolvedValue({ machineId: 'new-mac', revision: 2 })
    await confirmRecordingStart()
    expect(mocks.showConsent).toHaveBeenCalledTimes(1)
    expect(mocks.start).toHaveBeenCalledTimes(2)
    expect(mocks.start).toHaveBeenLastCalledWith({ machineId: 'new-mac', revision: 2 })
    expect(mocks.showConsent.mock.calls[0][0].message).toBe('personal_recording_consent')
  })
  it('does not start or remember consent when declined', async () => {
    mocks.showConsent.mockResolvedValueOnce(false)
    await confirmRecordingStart()
    expect(mocks.start).not.toHaveBeenCalled()
    await confirmRecordingStart()
    expect(mocks.showConsent).toHaveBeenCalledTimes(2)
    expect(mocks.start).toHaveBeenCalledTimes(1)
  })
  it('isolates accounts and asks again after privacy consent is revoked', async () => {
    await confirmRecordingStart()
    mocks.account = 'account-b'
    await confirmRecordingStart()
    await revokeAiDataConsents('account-b')
    await confirmRecordingStart()
    expect(mocks.showConsent).toHaveBeenCalledTimes(3)
  })
  it('does not start if the account changes while the confirmation is open', async () => {
    mocks.showConsent.mockImplementationOnce(async () => {
      mocks.account = 'account-b'
      return true
    })
    await confirmRecordingStart()
    expect(mocks.start).not.toHaveBeenCalled()
  })
  it('still requires a primary computer on later starts', async () => {
    await confirmRecordingStart()
    mocks.target.mockResolvedValue(null)
    await confirmRecordingStart()
    expect(mocks.start).toHaveBeenCalledTimes(1)
    expect(mocks.alert).toHaveBeenCalledWith('personal_start', 'personal_error_primary_machine_required')
  })
  it('reports start errors even when consent is already remembered', async () => {
    await confirmRecordingStart()
    mocks.state.error = 'microphone_permission_denied'
    await confirmRecordingStart()
    expect(mocks.alert).toHaveBeenCalledWith('personal_action_failed', 'personal_error_microphone_permission_denied')
  })
})
