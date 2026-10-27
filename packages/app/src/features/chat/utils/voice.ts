// @arch docs/architecture/app/chat-voice-draft.md
// @test src/__tests__/voice-utils.test.ts

export type VoiceComposerPhase = 'idle' | 'listening' | 'refining' | 'error'

export function isVoiceComposerInputReadOnly(phase: VoiceComposerPhase): boolean {
  return phase === 'listening'
}

function normalizeVoiceTranscriptText(value: string): string {
  return value.replace(/\r\n/g, '\n').trim()
}

function sharedEdgeLength(a: string, b: string, fromStart: boolean): number {
  const limit = Math.min(a.length, b.length)
  let count = 0
  while (count < limit) {
    const aChar = fromStart ? a[count] : a[a.length - 1 - count]
    const bChar = fromStart ? b[count] : b[b.length - 1 - count]
    if (aChar !== bChar) break
    count += 1
  }
  return count
}

export function appendVoiceTranscript(currentTranscript: string, nextText: string): string {
  const normalizedCurrent = normalizeVoiceTranscriptText(currentTranscript)
  const normalizedNext = normalizeVoiceTranscriptText(nextText)

  if (!normalizedNext) return normalizedCurrent
  if (!normalizedCurrent) return normalizedNext
  return `${normalizedCurrent}${normalizedNext}`
}

export function mergeVoiceFinalSegments(
  segments: string[],
  index: number,
  nextText: string,
): { segments: string[]; transcript: string } {
  const normalizedNext = normalizeVoiceTranscriptText(nextText)
  const nextSegments = segments.slice()

  if (!normalizedNext) {
    return {
      segments: nextSegments,
      transcript: nextSegments.map((segment) => normalizeVoiceTranscriptText(segment)).join(''),
    }
  }

  const safeIndex = Number.isInteger(index) && index >= 0 ? index : nextSegments.length
  const existing = normalizeVoiceTranscriptText(nextSegments[safeIndex] ?? '')

  if (!existing) {
    nextSegments[safeIndex] = normalizedNext
  } else if (
    normalizedNext === existing ||
    normalizedNext.startsWith(existing) ||
    existing.startsWith(normalizedNext)
  ) {
    nextSegments[safeIndex] = normalizedNext
  } else if (safeIndex === 0) {
    nextSegments.push(normalizedNext)
  } else {
    nextSegments[safeIndex] = normalizedNext
  }

  return {
    segments: nextSegments,
    transcript: nextSegments.map((segment) => normalizeVoiceTranscriptText(segment)).filter(Boolean).join(''),
  }
}

export function shouldRollVoiceInterimSegment(previousText: string, nextText: string): boolean {
  const previous = normalizeVoiceTranscriptText(previousText)
  const next = normalizeVoiceTranscriptText(nextText)

  if (!previous || !next) return false
  if (previous === next) return false
  if (next.startsWith(previous) || previous.startsWith(next)) return false

  const prefix = sharedEdgeLength(previous, next, true)
  const suffix = sharedEdgeLength(previous, next, false)
  const hasSentenceStop = /[。！？!?；;,.，:]$/.test(previous)

  if (hasSentenceStop && prefix <= 1 && suffix <= 1) return true
  if (previous.length >= 8 && next.length >= 2 && prefix === 0 && suffix === 0) return true

  return false
}

export function shouldExposeVoicePartial(previousDisplayedText: string, nextText: string): boolean {
  const previous = normalizeVoiceTranscriptText(previousDisplayedText)
  const next = normalizeVoiceTranscriptText(nextText)

  if (!next) return false
  if (!previous) return next.length >= 2 || /[。！？!?，,；;:]$/.test(next)
  if (next === previous) return true
  if (next.startsWith(previous)) return true
  if (next.length >= 2 && previous.length <= 2) return true

  return false
}

export function finalizeVoiceTranscriptSegment({
  committedBeforeSegment,
  segmentCommittedTranscript,
  segmentReportedTranscript,
  segmentInterimTranscript,
}: {
  committedBeforeSegment: string
  segmentCommittedTranscript: string
  segmentReportedTranscript: string
  segmentInterimTranscript: string
}): string {
  const normalizedReported = normalizeVoiceTranscriptText(segmentReportedTranscript)
  const normalizedFallback = appendVoiceTranscript(
    segmentCommittedTranscript,
    segmentInterimTranscript,
  )
  const resolvedSegment =
    normalizedReported.length >= normalizedFallback.length ? normalizedReported : normalizedFallback

  return appendVoiceTranscript(committedBeforeSegment, resolvedSegment)
}

export function mergeVoiceTranscriptIntoDraft(currentDraft: string, transcript: string): string {
  const nextTranscript = transcript.trim()
  if (!nextTranscript) return currentDraft

  if (!currentDraft.trim()) return nextTranscript
  if (/\s$/.test(currentDraft)) return `${currentDraft}${nextTranscript}`
  return `${currentDraft}\n${nextTranscript}`
}

function normalizeVoiceDraftText(value: string): string {
  return normalizeVoiceTranscriptText(value)
}

export function finalizeVoiceDraft({
  baseDraft,
  transcript,
  refinedDraft,
  intent,
}: {
  baseDraft: string
  transcript: string
  refinedDraft: string
  intent?: 'new' | 'append' | 'edit' | 'clarify'
}): string {
  const previewDraft = mergeVoiceTranscriptIntoDraft(baseDraft, transcript)
  const normalizedBaseDraft = normalizeVoiceDraftText(baseDraft)
  const normalizedPreviewDraft = normalizeVoiceDraftText(previewDraft)
  const normalizedRefinedDraft = normalizeVoiceDraftText(refinedDraft)
  const normalizedTranscript = normalizeVoiceDraftText(transcript)

  if (!normalizedRefinedDraft) {
    return previewDraft
  }

  const transcriptAddedVisibleText =
    Boolean(normalizedTranscript) &&
    normalizedPreviewDraft.length > 0 &&
    normalizedPreviewDraft !== normalizedBaseDraft

  if (
    transcriptAddedVisibleText &&
    normalizedRefinedDraft === normalizedBaseDraft
  ) {
    return previewDraft
  }

  // Guard against the common regression where the model returns only the latest
  // utterance and accidentally drops an existing draft during a follow-up voice input.
  if (
    normalizedBaseDraft &&
    transcriptAddedVisibleText &&
    normalizedRefinedDraft === normalizedTranscript &&
    intent !== 'edit' &&
    intent !== 'clarify'
  ) {
    return previewDraft
  }

  return refinedDraft.trim()
}

export function formatVoiceDuration(durationMillis: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMillis / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function voiceMeterToLevel(metering?: number): number {
  if (typeof metering !== 'number' || Number.isNaN(metering)) return 0
  const normalized = (metering + 60) / 60
  return Math.max(0, Math.min(1, normalized))
}

export function buildQuotedDraft(content: string): string {
  const trimmed = content.trim()
  if (!trimmed) return ''

  return trimmed
    .split('\n')
    .map((line) => (line.length > 0 ? `> ${line}` : '>'))
    .join('\n')
}

export function appendQuotedDraft(currentDraft: string, quotedContent: string): string {
  const quote = buildQuotedDraft(quotedContent)
  if (!quote) return currentDraft

  const trimmedCurrent = currentDraft.trimEnd()
  if (!trimmedCurrent) {
    return `${quote}\n\n`
  }

  return `${trimmedCurrent}\n\n${quote}\n\n`
}
