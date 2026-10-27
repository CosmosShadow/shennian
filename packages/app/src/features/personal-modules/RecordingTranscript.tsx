// @arch docs/features/listening.md
// @test src/__tests__/recording-transcript.test.ts
import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../hooks/useTheme'
import { mobileTypography } from '../../theme/mobileTypography'
import type { Transcript } from './types'
export function recordingTime(at: string, timezone: string, locale?: string) {
  if (!Number.isFinite(Date.parse(at))) return '—'
  try { return new Intl.DateTimeFormat(locale, { timeZone: timezone, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(at)) }
  catch { return new Date(at).toISOString().slice(11, 19) }
}
export function recordingText(item: Transcript, t: (key: string, options?: Record<string, unknown>) => string, locale?: string) {
  const time = (at: string) => recordingTime(at, item.timezone, locale)
  const lines = [`${time(item.startAt)}${item.kind === 'recording-feedback' ? ` · ${t('personal_recording_assistant')}` : ''}`]
  if (item.speakerStatus === 'done' && item.speakerSentences?.length) {
    for (const s of item.speakerSentences) {
      const startAt = new Date(Date.parse(item.startAt) + s.beginMs).toISOString()
      lines.push(`${time(startAt)} · ${s.speakerId === null ? t('listening_speaker_unknown') : t('listening_speaker_window', { number: s.speakerId + 1 })}\n${s.text}`)
    }
    // Preserve the original real-time transcription in exports as well.
    lines.push(`${t('listening_original_transcript')}\n${item.text}`)
  } else {
    lines.push(item.text)
    if (item.speakerStatus === 'unavailable') lines.push(t('listening_speakers_unavailable'))
  }
  return lines.join('\n')
}
export function RecordingTranscript({ item }: { item: Transcript }) {
  const { t, i18n } = useTranslation(), { colors } = useTheme()
  const [showOriginal, setShowOriginal] = useState(false)
  const time = (at: string) => recordingTime(at, item.timezone, i18n.language)
  return <View style={{ marginVertical: 10, gap: 4 }}>
    <Text style={{ ...mobileTypography.secondary, color: colors.textSecondary }}>
      {time(item.startAt)}{item.kind === 'recording-feedback' ? ` · ${t('personal_recording_assistant')}` : ''}
    </Text>
    {item.speakerStatus === 'done' && item.speakerSentences?.length ? <>
      {item.speakerSentences.map((s, index) => <View key={index} style={{ marginTop: 6, gap: 4 }}>
        <Text style={{ ...mobileTypography.secondary, color: colors.textSecondary }}>
          {time(new Date(Date.parse(item.startAt) + s.beginMs).toISOString())} · {s.speakerId === null ? t('listening_speaker_unknown') : t('listening_speaker_window', { number: s.speakerId + 1 })}
        </Text>
        <Text selectable style={{ ...mobileTypography.body, color: colors.text, lineHeight: 28 }}>{s.text}</Text>
      </View>)}
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: showOriginal }} onPress={() => setShowOriginal(value => !value)}>
        <Text style={{ ...mobileTypography.secondary, color: colors.brand }}>{t('listening_original_transcript')}</Text>
      </Pressable>
      {showOriginal ? <Text selectable style={{ ...mobileTypography.body, color: colors.text, lineHeight: 28 }}>{item.text}</Text> : null}
    </> : <>
      <Text selectable style={{ ...mobileTypography.body, color: item.kind === 'recording-feedback' ? colors.brand : colors.text, lineHeight: 28 }}>{item.text}</Text>
      {item.speakerStatus === 'unavailable' ? <Text style={{ ...mobileTypography.secondary, color: colors.textSecondary }}>{t('listening_speakers_unavailable')}</Text> : null}
    </>}
  </View>
}
