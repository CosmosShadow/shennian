// @covers src/features/personal-modules/voiceEntryMenu.ts
// @covers src/features/personal-modules/recordingDayMenu.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ platform: { OS: 'ios' }, sheet: vi.fn(), alert: vi.fn() }))
vi.mock('react-native', () => ({
  Platform: state.platform,
  ActionSheetIOS: { showActionSheetWithOptions: state.sheet },
  Alert: { alert: state.alert },
}))
import { showRecordingDayMenu } from '../features/personal-modules/recordingDayMenu'
import { showVoiceEntryMenu } from '../features/personal-modules/voiceEntryMenu'
afterEach(() => {
  vi.clearAllMocks()
  state.platform.OS = 'ios'
})
describe('home voice entry', () => {
  it('offers call or recording navigation without starting anything before a choice, including cancel', () => {
    const call = vi.fn(),
      records = vi.fn()
    showVoiceEntryMenu((key) => key, call, records)
    expect(state.sheet.mock.calls[0]?.[0].options).toEqual([
      'voice_chief_call_action',
      'personal_entry_recording',
      'cancel',
    ])
    expect(call).not.toHaveBeenCalled()
    expect(records).not.toHaveBeenCalled()
    const choose = state.sheet.mock.calls[0]![1]
    choose(2)
    expect(call).not.toHaveBeenCalled()
    expect(records).not.toHaveBeenCalled()
    choose(1)
    expect(records).toHaveBeenCalledOnce()
    expect(call).not.toHaveBeenCalled()
    choose(0)
    expect(call).toHaveBeenCalledOnce()
  })
  it('offers the same explicit choices on Android', () => {
    state.platform.OS = 'android'
    const call = vi.fn(),
      records = vi.fn()
    showVoiceEntryMenu((key) => key, call, records)
    expect(state.sheet).not.toHaveBeenCalled()
    const buttons = state.alert.mock.calls[0]![2]
    buttons[1].onPress()
    expect(records).toHaveBeenCalledOnce()
    expect(call).not.toHaveBeenCalled()
    buttons[0].onPress()
    expect(call).toHaveBeenCalledOnce()
    expect(buttons[2].style).toBe('cancel')
  })
})

describe('selected-day native actions', () => {
  it('keeps export, summary and deletion out of the transcript body and never deletes on dismiss', () => {
    const exportText = vi.fn(),
      summary = vi.fn(),
      confirm = vi.fn()
    showRecordingDayMenu('10月23日', (key) => key, exportText, summary, confirm)
    const [options, choose] = state.sheet.mock.calls[0]!
    expect(options.cancelButtonIndex).toBe(3)
    expect(options.destructiveButtonIndex).toBe(2)
    choose(3)
    expect(confirm).not.toHaveBeenCalled()
    choose(0)
    expect(exportText).toHaveBeenCalledOnce()
    choose(1)
    expect(summary).toHaveBeenCalledOnce()
    choose(2)
    expect(confirm).toHaveBeenCalledOnce()
  })
  it('keeps Android within its three-button limit and permits dismissal', () => {
    state.platform.OS = 'android'
    showRecordingDayMenu('10月23日', (key) => key, vi.fn(), vi.fn(), vi.fn())
    expect(state.alert.mock.calls[0]![2]).toHaveLength(3)
    expect(state.alert.mock.calls[0]![3]).toEqual({ cancelable: true })
  })
})
