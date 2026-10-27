// @covers packages/app/src/features/chat/utils/voice.ts

import { describe, expect, it } from 'vitest'
import {
  appendVoiceTranscript,
  appendQuotedDraft,
  buildQuotedDraft,
  finalizeVoiceDraft,
  finalizeVoiceTranscriptSegment,
  formatVoiceDuration,
  isVoiceComposerInputReadOnly,
  mergeVoiceFinalSegments,
  mergeVoiceTranscriptIntoDraft,
  shouldExposeVoicePartial,
  shouldRollVoiceInterimSegment,
  voiceMeterToLevel,
} from '../features/chat/utils/voice'

describe('voice utils', () => {
  it('keeps the composer read-only only while live dictation is updating it', () => {
    expect(isVoiceComposerInputReadOnly('idle')).toBe(false)
    expect(isVoiceComposerInputReadOnly('listening')).toBe(true)
    expect(isVoiceComposerInputReadOnly('refining')).toBe(false)
    expect(isVoiceComposerInputReadOnly('error')).toBe(false)
  })

  it('formats voice duration in m:ss', () => {
    expect(formatVoiceDuration(0)).toBe('0:00')
    expect(formatVoiceDuration(12_345)).toBe('0:12')
    expect(formatVoiceDuration(125_000)).toBe('2:05')
  })

  it('maps recorder metering into a 0-1 range', () => {
    expect(voiceMeterToLevel(undefined)).toBe(0)
    expect(voiceMeterToLevel(-60)).toBe(0)
    expect(voiceMeterToLevel(-30)).toBe(0.5)
    expect(voiceMeterToLevel(0)).toBe(1)
  })

  it('builds markdown blockquotes from a message', () => {
    expect(buildQuotedDraft('第一行\n\n第二行')).toBe('> 第一行\n>\n> 第二行')
  })

  it('appends finalized transcript chunks for continuous dictation', () => {
    expect(appendVoiceTranscript('', '你好')).toBe('你好')
    expect(appendVoiceTranscript('你好', '世界')).toBe('你好世界')
  })

  it('finalizes a rolled ASR segment into the cumulative transcript', () => {
    expect(
      finalizeVoiceTranscriptSegment({
        committedBeforeSegment: '第一段。',
        segmentCommittedTranscript: '第二段',
        segmentReportedTranscript: '第二段，补全',
        segmentInterimTranscript: '',
      }),
    ).toBe('第一段。第二段，补全')
  })

  it('updates finalized ASR chunks by index instead of blindly appending', () => {
    const first = mergeVoiceFinalSegments([], 0, '第一句。')
    expect(first.transcript).toBe('第一句。')

    const second = mergeVoiceFinalSegments(first.segments, 1, '第二句。')
    expect(second.transcript).toBe('第一句。第二句。')

    const corrected = mergeVoiceFinalSegments(second.segments, 1, '第二句，修正。')
    expect(corrected.transcript).toBe('第一句。第二句，修正。')
  })

  it('appends a new utterance when upstream reuses the same final index', () => {
    const first = mergeVoiceFinalSegments([], 0, '第一句。')
    const second = mergeVoiceFinalSegments(first.segments, 0, '第二句。')
    expect(second.transcript).toBe('第一句。第二句。')
  })

  it('detects when a rolling interim transcript has reset to a new utterance', () => {
    expect(shouldRollVoiceInterimSegment('第一句已经说完。', '第二句开始')).toBe(true)
    expect(shouldRollVoiceInterimSegment('Anthropic 这家公司怎么样？', 'OpenAI 呢')).toBe(true)
    expect(shouldRollVoiceInterimSegment('第一句', '第一句补充一点')).toBe(false)
    expect(shouldRollVoiceInterimSegment('OpenAI', 'OpenAI')).toBe(false)
  })

  it('only exposes partial transcript when it is stable enough to preview', () => {
    expect(shouldExposeVoicePartial('', '你')).toBe(false)
    expect(shouldExposeVoicePartial('', '你好')).toBe(true)
    expect(shouldExposeVoicePartial('', '你好啊')).toBe(true)
    expect(shouldExposeVoicePartial('', '你好啊。')).toBe(true)
    expect(shouldExposeVoicePartial('Open', 'OpenAI')).toBe(true)
    expect(shouldExposeVoicePartial('Anthropic', '桉树皮')).toBe(false)
  })

  it('appends quoted content to an existing draft', () => {
    expect(appendQuotedDraft('', '你好')).toBe('> 你好\n\n')
    expect(appendQuotedDraft('继续处理', '你好')).toBe('继续处理\n\n> 你好\n\n')
  })

  it('merges live transcript directly into the composer draft', () => {
    expect(mergeVoiceTranscriptIntoDraft('', '你好')).toBe('你好')
    expect(mergeVoiceTranscriptIntoDraft('先看这里', '你好')).toBe('先看这里\n你好')
    expect(mergeVoiceTranscriptIntoDraft('先看这里\n', '你好')).toBe('先看这里\n你好')
  })

  it('keeps the live transcript when refine result regresses to the original draft', () => {
    expect(
      finalizeVoiceDraft({
        baseDraft: '第一行\n第二行',
        transcript: '第三行',
        refinedDraft: '第一行\n第二行',
      }),
    ).toBe('第一行\n第二行\n第三行')
  })

  it('returns the refined draft when it still contains the finalized content', () => {
    expect(
      finalizeVoiceDraft({
        baseDraft: '第一行\n第二行',
        transcript: '第三行',
        refinedDraft: '第一行\n第二行\n第三行，顺便整理一下',
        intent: 'append',
      }),
    ).toBe('第一行\n第二行\n第三行，顺便整理一下')
  })

  it('keeps the existing draft when a follow-up append regresses to transcript only', () => {
    expect(
      finalizeVoiceDraft({
        baseDraft: '第一行\n第二行',
        transcript: '第三行',
        refinedDraft: '第三行',
        intent: 'append',
      }),
    ).toBe('第一行\n第二行\n第三行')
  })

  it('allows transcript-only replacement when the voice intent is an explicit edit', () => {
    expect(
      finalizeVoiceDraft({
        baseDraft: '把标题改成语音版本',
        transcript: '改一下，标题换成神念语音模式',
        refinedDraft: '改一下，标题换成神念语音模式',
        intent: 'edit',
      }),
    ).toBe('改一下，标题换成神念语音模式')
  })
})
