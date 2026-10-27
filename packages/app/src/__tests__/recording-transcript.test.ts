// @vitest-environment happy-dom
// @covers src/features/personal-modules/RecordingTranscript.tsx
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('react-native', () => ({
  View: ({ children }: any) => React.createElement('div', null, children),
  Text: ({ children }: any) => React.createElement('span', null, children),
  Pressable: ({ children, onPress }: any) => React.createElement('button', { onClick: onPress }, children),
}))
const t = (key: string, options?: Record<string, unknown>) => key === 'listening_speaker_window' ? `本段说话人 ${options?.number}` : key
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t, i18n: { language: 'zh-CN' } }) }))
vi.mock('../hooks/useTheme', () => ({ useTheme: () => ({ colors: {} }) }))
import { RecordingTranscript, recordingText, recordingTime } from '../features/personal-modules/RecordingTranscript'
import type { Transcript } from '../features/personal-modules/types'
const item: Transcript = { key: 'window', sessionKey: 'session', revision: 1, startAt: '2026-10-25T01:02:03Z', endAt: '2026-10-25T01:03:03Z', text: '原始实时转写', timezone: 'Asia/Shanghai', day: '2026-10-25' }
afterEach(() => vi.unstubAllGlobals())
describe('timestamped recording paragraphs and exports', () => {
  it('shows capture time in the recording timezone, including legacy transcripts', () => {
    expect(recordingText(item, t)).toBe('09:02:03\n原始实时转写')
    expect(recordingText({ ...item, kind: 'recording-feedback' }, t)).toContain(' · personal_recording_assistant')
    expect(recordingTime('invalid', 'Asia/Shanghai')).toBe('—')
    expect(recordingTime(item.startAt, 'invalid')).toBe('01:02:03')
  })
  it.each([undefined, 'recording-feedback'] as const)('renders only the start time for %s paragraphs', async (kind) => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const host = document.createElement('div'), root = createRoot(host)
    try {
      await act(async () => root.render(React.createElement(RecordingTranscript, { item: { ...item, kind } })))
      expect(host.textContent).toContain('09:02:03')
      expect(host.textContent).toContain(item.text)
      expect(host.textContent).not.toContain('09:03:03')
      expect(host.textContent).not.toContain(' – ')
      expect(recordingText({ ...item, kind }, t)).not.toContain('09:03:03')
      if (kind) expect(host.textContent).toContain(' · personal_recording_assistant')
    } finally { await act(async () => root.unmount()) }
  })
  it('exports window-local speakers with absolute times, unknown labels, and original transcript', () => {
    const text = recordingText({ ...item, speakerStatus: 'done', speakerSentences: [
      { beginMs: 0, endMs: 500, speakerId: 0, text: '甲' },
      { beginMs: 500, endMs: 1500, speakerId: 1, text: '乙' },
      { beginMs: 1500, endMs: 2000, speakerId: null, text: '未确定' },
    ] }, t)
    expect(text).toContain('09:02:03 · 本段说话人 1\n甲')
    expect(text).toContain('09:02:03 · 本段说话人 2\n乙')
    expect(text).toContain('09:02:04 · listening_speaker_unknown\n未确定')
    expect(text).not.toContain(' – ')
    expect(text).toContain('listening_original_transcript\n原始实时转写')
    expect(recordingText({ ...item, speakerStatus: 'unavailable' }, t)).toContain('listening_speakers_unavailable')
  })
  it('renders readable time/speaker paragraphs and reveals original text only on request', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const host = document.createElement('div'), root = createRoot(host)
    try {
      await act(async () => root.render(React.createElement(RecordingTranscript, { item: { ...item, speakerStatus: 'done', speakerSentences: [{ beginMs: 0, endMs: 10000, speakerId: 0, text: '分人文字' }] } })))
      expect(host.textContent).toContain('09:02:03')
      expect(host.textContent).not.toContain('09:03:03')
      expect(host.textContent).not.toContain('09:02:13')
      expect(host.textContent).not.toContain(' – ')
      expect(host.textContent).toContain('本段说话人 1分人文字')
      expect(host.textContent).not.toContain('原始实时转写')
      await act(async () => host.querySelector('button')!.click())
      expect(host.textContent).toContain('原始实时转写')
    } finally { await act(async () => root.unmount()) }
  })
})

it('ships matching Chinese and English runtime translations for recording privacy and speaker labels', async () => {
  const { zhPersonalModules } = await import('../../../../open-source/packages/shared/src/i18n/zh-personal-modules')
  const { enPersonalModules } = await import('../../../../open-source/packages/shared/src/i18n/en-personal-modules')
  for (const key of ['personal_recording_hint', 'personal_recording_consent', 'listening_speaker_window', 'listening_speaker_unknown', 'listening_speakers_unavailable', 'listening_original_transcript'] as const) {
    expect(zhPersonalModules[key]).toBeTruthy()
    expect(enPersonalModules[key]).toBeTruthy()
  }
})
