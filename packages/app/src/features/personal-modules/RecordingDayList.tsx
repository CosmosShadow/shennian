// @arch docs/features/listening.md
// @test src/__tests__/recording-day-list.test.ts
import { useEffect, useRef, useState } from 'react'
import { useIsFocused } from '@react-navigation/native'
import { Pressable, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../hooks/useTheme'
import { useAuthStore } from '../../config/auth'
import { authApi } from '../../config/api'
import { mobileTypography } from '../../theme/mobileTypography'
import { moduleStore } from './runtime'
import type { Transcript } from './types'

export function recordingExcerpt(rows: Transcript[], day: string) {
  const latest = new Map<string, Transcript>()
  for (const row of rows)
    if (
      row.day === day &&
      (!row.kind || row.kind === 'transcript') &&
      (!latest.has(row.key) || latest.get(row.key)!.revision <= row.revision)
    )
      latest.set(row.key, row)
  return [...latest.values()]
    .sort((a, b) => a.startAt.localeCompare(b.startAt))
    .slice(-4)
    .map((row) => row.text.trim())
    .filter(Boolean)
    .join('\n')
}
/** Replace this live segment's saved revision, never append its partial twice. */
export function recordingLiveExcerpt(rows: Transcript[], day: string, live?: { key: string; text: string }) {
  if (!live?.text.trim()) return recordingExcerpt(rows, day)
  return [recordingExcerpt(rows.filter(row => row.key !== live.key), day), live.text.trim()]
    .filter(Boolean).join('\n')
}
export function recordingDate(day: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', day: 'numeric' }).format(
    new Date(`${day}T12:00:00`),
  )
}
/** Bounded excerpts only; opening a day still uses the complete paginated original. */
export function RecordingDayList({
  days,
  knownDay,
  transcripts,
  openDay,
  active = false,
  live,
}: {
  days: string[]
  knownDay: string
  transcripts: Transcript[]
  openDay: (day: string) => void
  active?: boolean
  live?: { key: string; text: string }
}) {
  const { t, i18n } = useTranslation(),
    { colors } = useTheme()
  const focused = useIsFocused()
  const account = useAuthStore((s) => s.user?.id)
  const [previews, setPreviews] = useState<{ account?: string; values: Record<string, string> }>({
    values: {},
  })
  const previewRef = useRef(previews)
  previewRef.current = previews
  const dayKey = days.join(',')
  useEffect(() => {
    let cancelled = false
    const current = () => !cancelled && useAuthStore.getState().user?.id === account
    if (!account || !focused) return
    const queue = dayKey
      .split(',')
      .filter(
        (day) =>
          /^\d{4}-\d{2}-\d{2}$/.test(day) &&
          day !== knownDay &&
          !(previewRef.current.account === account && day in previewRef.current.values),
      )
    const run = async () => {
      const store = await moduleStore()
      while (queue.length && current()) {
        const day = queue.shift()!
        if (await store.isDayDeleted(day)) continue
        const local = [
          ...(await store.transcripts(day)),
          ...((await store.cached<Transcript[]>(`day:${day}`)) ?? []),
        ]
        const apply = (rows: Transcript[]) => {
          if (current())
            setPreviews((old) => ({
              account,
              values: {
                ...(old.account === account ? old.values : {}),
                [day]: recordingExcerpt(rows, day),
              },
            }))
        }
        apply(local)
        if (!current()) return
        try {
          const result = await authApi<{ items: Transcript[] }>(
            `/personal-modules/recording/days/${day}`,
          )
          if (!(await store.isDayDeleted(day))) apply([...result.items, ...local])
        } catch {
          /* Keep real cached excerpts; never synthesize a summary. */
        }
      }
    }
    void Promise.all([run(), run()]).catch(() => {})
    return () => {
      cancelled = true
    }
  }, [account, dayKey, knownDay, focused])
  return (
    <View>
      {days.map((day) => {
        const excerpt =
          day === knownDay
            ? recordingLiveExcerpt(transcripts, day, active ? live : undefined)
            : previews.account === account
              ? previews.values[day]
              : ''
        return (
          <Pressable
            key={day}
            testID={`recording-day-${day}`}
            accessibilityRole="button"
            onPress={() => openDay(day)}
            style={{
              paddingVertical: 22,
              borderBottomWidth: 0.5,
              borderBottomColor: colors.separator,
              gap: 10,
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <Text style={{ ...mobileTypography.listTitle, color: colors.text }}>
                {recordingDate(day, i18n?.language || 'zh-CN')}
              </Text>
              <Text style={{ ...mobileTypography.secondary, color: colors.textSecondary }}>
                {active && day === knownDay ? t('personal_recording_active') : '›'}
              </Text>
            </View>
            {excerpt ? (
              <Text
                numberOfLines={3}
                ellipsizeMode="head"
                accessibilityLiveRegion={active && day === knownDay ? 'polite' : undefined}
                style={{ ...mobileTypography.body, lineHeight: 27, color: colors.textSecondary }}
              >
                {excerpt}
              </Text>
            ) : day === knownDay ? (
              <Text style={{ ...mobileTypography.secondary, color: colors.textSecondary }}>
                {t(active ? 'listening_waiting' : 'personal_empty')}
              </Text>
            ) : null}
          </Pressable>
        )
      })}
    </View>
  )
}
