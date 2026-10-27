// @covers packages/app/src/features/voice-chief/transcript.ts

import { describe, expect, it, vi } from 'vitest'
import {
  mergeVoiceChiefTranscript,
  normalizeVoiceChiefTranscriptDisplay,
} from '../features/voice-chief/transcript'

describe('Voice Chief streaming transcript', () => {
  it('removes empty display lines without joining meaningful line breaks', () => {
    expect(normalizeVoiceChiefTranscriptDisplay('第一句。\n\n  \n第二句。\r\n\r\n第三句。')).toBe(
      '第一句。\n第二句。\n第三句。',
    )
  })

  it('accumulates deltas for one response and replaces them with the final transcript', () => {
    let transcript = mergeVoiceChiefTranscript([], {
      role: 'chief',
      text: '学习',
      final: false,
      responseId: 'response-1',
    })
    transcript = mergeVoiceChiefTranscript(transcript, {
      role: 'chief',
      text: '项目',
      final: false,
      responseId: 'response-1',
    })
    transcript = mergeVoiceChiefTranscript(transcript, {
      role: 'chief',
      text: '？',
      final: false,
      responseId: 'response-1',
    })
    expect(transcript).toMatchObject([{ text: '学习项目？', final: false }])

    transcript = mergeVoiceChiefTranscript(transcript, {
      role: 'chief',
      text: '你是想看学习项目的进展吗？',
      final: true,
      responseId: 'response-1',
      completedAt: 42,
    })
    expect(transcript).toEqual([
      {
        id: 'chief:response-1:42',
        role: 'chief',
        text: '你是想看学习项目的进展吗？',
        final: true,
      },
    ])
  })

  it('does not merge deltas from different assistant responses', () => {
    const first = mergeVoiceChiefTranscript([], {
      role: 'chief',
      text: '第一句',
      final: false,
      responseId: 'response-1',
    })
    const second = mergeVoiceChiefTranscript(first, {
      role: 'chief',
      text: '第二句',
      final: false,
      responseId: 'response-2',
    })
    expect(second.map((item) => item.text)).toEqual(['第一句', '第二句'])
  })

  it('accumulates user transcript deltas before final calibration', () => {
    let transcript = mergeVoiceChiefTranscript([], {
      role: 'user',
      text: '学习项目',
      final: false,
    })
    transcript = mergeVoiceChiefTranscript(transcript, {
      role: 'user',
      text: '有哪些任务',
      final: false,
    })
    expect(transcript).toMatchObject([{ text: '学习项目有哪些任务', final: false }])

    transcript = mergeVoiceChiefTranscript(transcript, {
      role: 'user',
      text: '学习项目有哪些正在进行的任务？',
      final: true,
      completedAt: 84,
    })
    expect(transcript).toMatchObject([
      { id: 'user:active:84', text: '学习项目有哪些正在进行的任务？', final: true },
    ])
  })
})

// @covers packages/app/src/features/voice-chief/subtitlePreference.ts

import {
  loadVoiceChiefSubtitlePreference,
  saveVoiceChiefSubtitlePreference,
  type VoiceChiefSubtitleStore,
} from '../features/voice-chief/subtitlePreference'

function store(value: string | null): VoiceChiefSubtitleStore {
  return { getItem: vi.fn().mockResolvedValue(value), setItem: vi.fn().mockResolvedValue(undefined) }
}

describe('Voice Chief subtitle preference', () => {
  it('defaults subtitles on and preserves an explicit user choice', async () => {
    expect(await loadVoiceChiefSubtitlePreference(store(null))).toBe(true)
    expect(await loadVoiceChiefSubtitlePreference(store('false'))).toBe(false)
    expect(await loadVoiceChiefSubtitlePreference(store('true'))).toBe(true)

    const target = store(null)
    await saveVoiceChiefSubtitlePreference(false, target)
    expect(target.setItem).toHaveBeenCalledWith('shennian:voice-chief:subtitles', 'false')
  })
})
