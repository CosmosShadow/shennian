import { RecordingTranscript, recordingText } from './RecordingTranscript'
import { locationStore } from './locationStore'
import { RecordingRoute } from './RecordingRoute'
import PersonalEnglishScreen from './PersonalEnglishScreen'
import { rememberEnglishPreference, useEnglishPreference } from './englishPreference'
import { showListeningMenu } from './listeningMenu'
import { showRecordingDayMenu } from './recordingDayMenu'
import { recordingDestination, type RecordingView } from './recordingNavigation'
import { RecordingSyncNotice } from './RecordingSyncNotice'
import { RecordingCaptureControl } from './RecordingCaptureControl'
import { RecordingDayList, recordingDate } from './RecordingDayList'
import { useContextualSteward } from '../steward/ContextualStewardContext'
import { mobileTypography } from '../../theme/mobileTypography'
import { ListeningControls } from './ListeningControls'
import { ListeningActions } from './ListeningActions'
import { useMobileModuleBack } from '../../components/useMobileModuleBack'
import PersonalScheduleScreen from './PersonalScheduleScreen'
// @arch docs/features/personal-modules.md
// @test src/__tests__/personal-modules.test.ts
// @test src/__tests__/recording-home.test.ts
import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, AppState, Keyboard, Pressable, ScrollView, Share, Text, View } from 'react-native'
import { useIsFocused } from '@react-navigation/native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTranslation } from 'react-i18next'
import { useMachinesStore } from '@shennian/shared'
import { AppPageHeader, HeaderIconButton } from '../../components/AppPageHeader'
import { useTheme } from '../../hooks/useTheme'
import { useAuthStore } from '../../config/auth'
import { authApi } from '../../config/api'
import {
  moduleStore,
  clearEnglishFeedback,
  confirmRecordingOldTarget,
  setListeningPreferences,
  stopRecording,
  syncModules,
  useRecordingState,
} from './runtime'
import { confirmRecordingStart } from './confirmRecordingStart'
import { localDay, type Candidate, type EnglishItem, type Reminder, type Transcript } from './types'
type Gap = { key: string; startAt: string; endAt: string; day: string; reason: string }
type Tab = 'recording' | 'english' | 'reminders'
export default function PersonalModulesScreen() {
  const params = useLocalSearchParams<{
    tab?: string
    recordingView?: string
    recordingDay?: string
  }>()
  if (params.tab === 'english') return <PersonalEnglishScreen />
  return params.tab === 'reminders' ? <PersonalScheduleScreen /> : <OtherPersonalModulesScreen />
}
function OtherPersonalModulesScreen() {
  const { t, i18n } = useTranslation(),
    { colors } = useTheme()
  const moduleBack = useMobileModuleBack()
  const userId = useAuthStore((s) => s.user?.id)
  const machines = useMachinesStore((s) => s.machines)
  const recording = useRecordingState()
  const params = useLocalSearchParams<{
    tab?: string
    recordingView?: string
    recordingDay?: string
  }>()
  const directTab = ['recording', 'english', 'reminders'].includes(params.tab ?? '')
    ? (params.tab as Tab)
    : null
  const router = useRouter()
  const focused = useIsFocused()
  const recordingPage: RecordingView = ['home', 'days', 'day', 'settings'].includes(
    params.recordingView || '',
  )
    ? (params.recordingView as RecordingView)
    : 'home'
  const steward = useContextualSteward()
  const [tab, setTab] = useState<Tab>(directTab ?? 'recording')
  useEffect(() => {
    if (['recording', 'english', 'reminders'].includes(params.tab ?? '')) setTab(params.tab as Tab)
  }, [params.tab])
  const [day, setDay] = useState(() =>
    params.recordingDay &&
    /^\d{4}-\d{2}-\d{2}$/.test(params.recordingDay) &&
    localDay(new Date(`${params.recordingDay}T12:00:00`)) === params.recordingDay
      ? params.recordingDay
      : localDay(),
  )
  const [days, setDays] = useState<string[]>([])
  const [before, setBefore] = useState<string | null>(null)
  const [transcripts, setTranscripts] = useState<Transcript[]>([])
  const [gaps, setGaps] = useState<Gap[]>([])
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const enabled = useEnglishPreference((state) =>
    state.accountId === userId ? state.enabled : null,
  )
  const setEnabled = useCallback(
    (value: boolean, seed = false) => {
      if (userId && useAuthStore.getState().user?.id === userId)
        rememberEnglishPreference(userId, value, seed)
    },
    [userId],
  )
  const [intervalMinutes, setIntervalMinutes] = useState('5')
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(false)
  const [offline, setOffline] = useState(false)
  const [summary, setSummary] = useState<string | null>(null)
  const loadEpoch = useRef(0)
  const scrollRef = useRef<ScrollView>(null)
  const initiallyPositioned = useRef(false)
  const [dayReady, setDayReady] = useState(false)
  useEffect(() => {
    steward?.setDetails((previous) => ({
      ...previous,
      tab,
      recordingView: recordingPage,
      recordingDay: day,
    }))
  }, [steward?.setDetails, tab, recordingPage, day])
  useEffect(() => {
    if (recordingPage !== 'home' || !focused) return
    const timer = setInterval(() => setDay(localDay()), 30000)
    return () => clearInterval(timer)
  }, [recordingPage, focused])
  const openRecordingView = (view: RecordingView, value = localDay()) => {
    Keyboard.dismiss()
    router.push(recordingDestination(view, value))
  }
  const openDay = (value: string) => openRecordingView('day', value)
  const path = '/personal-modules'
  const load = useCallback(async () => {
    if (!userId || !focused) return
    const epoch = ++loadEpoch.current
    const store = await moduleStore()
    const live = () => useAuthStore.getState().user?.id === userId && loadEpoch.current === epoch
    const cached = await store.cached<{
      words: EnglishItem[]
      reminders: Reminder[]
      enabled: boolean
      intervalMinutes: number
      candidates: Candidate[]
    }>('overview')
    if (!live()) return
    const cachedEnabled = await store.cached<boolean>('english-enabled')
    if (!live()) return
    if (cachedEnabled !== null && cachedEnabled !== undefined) setEnabled(cachedEnabled, true)
    else if (cached) setEnabled(cached.enabled, true)
    if (cached) {
      setIntervalMinutes(String(cached.intervalMinutes))
      setCandidates(cached.candidates)
    }
    const local = await store.transcripts(day)
    const localDays = [
      ...new Set([...(await store.days()), ...(await locationStore.days(userId).catch(() => []))]),
    ]
    const localGaps = (await store.values<Gap>('gap')).filter((x) => x.day === day)
    if (!live()) return
    setGaps(localGaps)
    if (!live()) return
    const cachedDay = await store.cached<Transcript[]>(`day:${day}`)
    if (!live()) return
    setTranscripts(
      [
        ...new Map(
          [...(cachedDay ?? []), ...local.filter((x) => x.day === day)].map((x) => [x.key, x]),
        ).values(),
      ].sort((a, b) => a.startAt.localeCompare(b.startAt)),
    )
    setDays([...new Set([day, ...localDays])].sort().reverse())
    try {
      await store.flush()
      const [a, b, c, d, e] = await Promise.all([
        authApi<{ items: EnglishItem[] }>(`${path}/english/items`),
        authApi<{ items: Reminder[] }>(`${path}/reminders`),
        authApi<{ enabled: boolean; intervalMinutes: number }>(`${path}/english/preferences`),
        authApi<{ items: Candidate[] }>(`${path}/recording/candidates`),
        authApi<{ days: string[]; nextBefore: string | null }>(`${path}/recording/days`),
      ])
      if (!live()) return
      setEnabled(c.enabled)
      await store.cache('english-enabled', c.enabled)
      if (!live()) return
      setIntervalMinutes(String(c.intervalMinutes))
      setCandidates(d.items)
      setDays([...new Set([day, ...e.days, ...localDays])].sort().reverse())
      setBefore(e.nextBefore)
      const remoteGaps: Gap[] = [...localGaps]
      const merged = new Map(local.filter((x) => x.day === day).map((x) => [x.key, x]))
      let cursor: string | null = null
      do {
        const page: { items: Transcript[]; nextCursor: string | null } = await authApi(
          `${path}/recording/days/${day}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
        )
        if (!live()) return
        for (const item of page.items)
          if (item.kind === 'recording-gap') remoteGaps.push(item as unknown as Gap)
          else if (item.kind === 'transcript' || item.kind === 'recording-feedback') {
            const previous = merged.get(item.key)
            if (!previous || previous.revision <= item.revision) merged.set(item.key, item)
          }
        cursor = page.nextCursor
      } while (cursor)
      setGaps([...new Map(remoteGaps.map((x) => [x.key, x])).values()])
      await store.cache(`day:${day}`, [...merged.values()])
      setTranscripts([...merged.values()].sort((a, b) => a.startAt.localeCompare(b.startAt)))
      await store.cache('overview', {
        words: a.items,
        reminders: b.items.slice(0, 200),
        enabled: c.enabled,
        intervalMinutes: c.intervalMinutes,
        candidates: d.items,
      })
      setOffline(false)
    } catch {
      if (live()) setOffline(true)
    } finally {
      if (live()) setDayReady(true)
    }
  }, [userId, day, focused, setEnabled])
  useEffect(() => {
    if (!focused) return
    setSummary(null)
    void load().catch(() => setError(true))
    const subscription = AppState.addEventListener('change', (value) => {
      if (value === 'active') void load().catch(() => setError(true))
    })
    return () => {
      loadEpoch.current++
      subscription.remove()
    }
  }, [load])
  useEffect(() => {
    if (!focused) return
    const timer = setTimeout(() => {
      void moduleStore()
        .then(async (s) => {
          if (await s.isDayDeleted(day)) {
            setTranscripts([])
            return []
          }
          return s.transcripts(day)
        })
        .then((items) => {
          if (useAuthStore.getState().user?.id === userId)
            setTranscripts((old) =>
              [
                ...new Map(
                  [...old.filter((i) => i.day === day), ...items.filter((i) => i.day === day)].map(
                    (i) => [i.key, i],
                  ),
                ).values(),
              ].sort((a, b) => a.startAt.localeCompare(b.startAt)),
            )
        })
        .catch(() => {})
    }, 200)
    return () => clearTimeout(timer)
  }, [recording.revision, day, focused])
  useEffect(() => {
    if (recordingPage !== 'day' || !dayReady || initiallyPositioned.current) return
    const frame = requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated: false })
      initiallyPositioned.current = true
    })
    return () => cancelAnimationFrame(frame)
  }, [recordingPage, dayReady])
  const action = async (work: () => Promise<unknown>, reload = true) => {
    setBusy(true)
    setError(false)
    try {
      await work()
      if (reload) await load()
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }
  const button = (label: string, run: () => void, disabled = busy) => (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={run}
      style={{ paddingVertical: 12, paddingHorizontal: 15, opacity: disabled ? 0.4 : 1 }}
    >
      <Text style={{ color: colors.text }}>{label}</Text>
    </Pressable>
  )
  const box = { backgroundColor: colors.surface, borderRadius: 12, padding: 14, marginVertical: 8 }
  const confirmDelete = () =>
    Alert.alert(t('personal_delete_day'), t('personal_delete_day_hint'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('delete'),
        style: 'destructive',
        onPress: () =>
          void action(async () => {
            if (recording.active) await stopRecording()
            await (await moduleStore()).deleteDay(day)
            setTranscripts([])
            await syncModules()
          }),
      },
    ])
  const exportDay = () =>
    void action(() =>
      Share.share({
        message: `# ${day}\n\n${transcripts
          .filter((item) => item.day === day)
          .map((item) => recordingText(item, t, i18n.language))
          .join('\n\n')}`,
      }),
    )
  const summarizeDay = () =>
    void action(async () => {
      const result = await authApi<{ summary: string | null }>(
        `${path}/recording/days/${day}/summary`,
        { method: 'POST', body: '{}' },
      )
      setSummary(result.summary ?? t('personal_summary_unavailable'))
    })
  if (tab === 'reminders') return <PersonalScheduleScreen />
  if (tab === 'english') return <PersonalEnglishScreen />
  return (
    <SafeAreaView
      style={{
        flex: 1,
        backgroundColor: colors.bg,
      }}
      edges={['top']}
    >
      <AppPageHeader
        title={
          tab === 'recording'
            ? recordingPage === 'day'
              ? recordingDate(day, i18n.language)
              : t(
                  recordingPage === 'days'
                    ? 'listening_all_records'
                    : recordingPage === 'settings'
                      ? 'listening_settings'
                      : 'personal_entry_recording',
                )
            : t(directTab ? `personal_entry_${directTab}` : 'personal_modules')
        }
        onBack={moduleBack}
        trailing={
          tab === 'recording' && recordingPage === 'home' ? (
            <HeaderIconButton
              icon="ellipsis-horizontal"
              label={t('composer_more_actions')}
              testID="recording-open-settings"
              onPress={() =>
                showListeningMenu(
                  t('personal_entry_recording'),
                  [t('listening_settings')],
                  t('cancel'),
                  () => openRecordingView('settings'),
                )
              }
            />
          ) : tab === 'recording' && recordingPage === 'day' ? (
            <HeaderIconButton
              icon="ellipsis-horizontal"
              label={t('composer_more_actions')}
              disabled={busy}
              onPress={() =>
                showRecordingDayMenu(
                  recordingDate(day, i18n.language),
                  t,
                  exportDay,
                  summarizeDay,
                  confirmDelete,
                )
              }
            />
          ) : undefined
        }
      />
      {!directTab && (
        <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
          {(['recording', 'english', 'reminders'] as Tab[]).map((name) => (
            <Pressable
              key={name}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === name }}
              onPress={() => setTab(name)}
              style={{
                padding: 12,
                borderBottomWidth: tab === name ? 2 : 0,
                borderColor: colors.text,
              }}
            >
              <Text style={{ color: colors.text }}>{t(`personal_${name}`)}</Text>
            </Pressable>
          ))}
        </View>
      )}
      <ScrollView
        ref={scrollRef}
        keyboardShouldPersistTaps="handled"
        style={{
          backgroundColor:
            tab === 'recording' && ['home', 'settings'].includes(recordingPage)
              ? colors.surfaceHover
              : colors.bg,
        }}
        contentContainerStyle={{
          paddingHorizontal:
            tab === 'recording' && ['home', 'settings'].includes(recordingPage) ? 0 : 24,
          paddingTop: tab === 'recording' && ['home', 'settings'].includes(recordingPage) ? 16 : 8,
          paddingBottom: 24,
          flexGrow: 1,
        }}
      >
        {offline && recordingPage !== 'home' ? (
          <Text style={{ color: colors.textSecondary }}>{t('personal_offline')}</Text>
        ) : null}
        {error && recordingPage !== 'home' ? (
          <Text accessibilityRole="alert" style={{ color: colors.errorText }}>
            {t('personal_action_failed')}
          </Text>
        ) : null}
        {tab !== 'recording' ? button(t('personal_refresh'), () => void action(load)) : null}
        {tab === 'recording' ? (
          <>
            {recordingPage === 'home' ? (
              <>
                <View
                  style={{
                    marginHorizontal: 16,
                    paddingHorizontal: 20,
                    borderRadius: 16,
                    overflow: 'hidden',
                    backgroundColor: colors.groupedSurface,
                  }}
                >
                  <RecordingDayList
                    days={[localDay()]}
                    knownDay={day}
                    transcripts={transcripts}
                    openDay={openDay}
                    active={recording.active}
                    live={
                      recording.liveTranscriptKey
                        ? {
                            key: recording.liveTranscriptKey,
                            text: recording.partial || recording.finalText,
                          }
                        : undefined
                    }
                  />
                  <Pressable
                    accessibilityRole="button"
                    testID="recording-all-days"
                    onPress={() => openRecordingView('days')}
                    style={{
                      minHeight: 56,
                      borderBottomWidth: 0.5,
                      borderBottomColor: colors.separator,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <Text style={{ ...mobileTypography.body, color: colors.text }}>
                      {t('listening_more_records')}
                    </Text>
                    <Text style={{ color: colors.textSecondary }}>›</Text>
                  </Pressable>
                </View>
                <ListeningControls
                  preferences={recording.preferences}
                  busy={busy}
                  analysisProvider={recording.analysisProvider}
                  englishEnabled={enabled}
                  save={(next) => void action(() => setListeningPreferences(next), false)}
                  setEnglish={(value) =>
                    void action(async () => {
                      const store = await moduleStore()
                      await authApi(`${path}/english/preferences`, {
                        method: 'PATCH',
                        body: JSON.stringify({
                          enabled: value,
                          intervalMinutes: Number(intervalMinutes),
                        }),
                      })
                      if (useAuthStore.getState().user?.id !== store.userId) return
                      setEnabled(value)
                      await store.cache('english-enabled', value)
                      if (!value) clearEnglishFeedback()
                    }, false)
                  }
                />
                <ListeningActions
                  revision={recording.revision}
                  active={recording.active}
                  preview
                  openDay={(value) => openDay(value || localDay())}
                />
                {recording.prompt && Date.parse(recording.prompt.expiresAt) > Date.now() ? (
                  <Text
                    style={{
                      ...mobileTypography.body,
                      color: colors.text,
                      lineHeight: 26,
                      marginTop: 16,
                    }}
                  >
                    {recording.prompt.text}
                  </Text>
                ) : null}
              </>
            ) : null}
            {recordingPage === 'settings' ? (
              <>
                <ListeningControls
                  section="advanced"
                  preferences={recording.preferences}
                  busy={busy}
                  analysisProvider={recording.analysisProvider}
                  englishEnabled={enabled}
                  save={(next) => void action(() => setListeningPreferences(next), false)}
                  setEnglish={(value) =>
                    void action(async () => {
                      const store = await moduleStore()
                      await authApi(`${path}/english/preferences`, {
                        method: 'PATCH',
                        body: JSON.stringify({
                          enabled: value,
                          intervalMinutes: Number(intervalMinutes),
                        }),
                      })
                      if (useAuthStore.getState().user?.id !== store.userId) return
                      setEnabled(value)
                      await store.cache('english-enabled', value)
                      if (!value) clearEnglishFeedback()
                    }, false)
                  }
                />
                <View
                  style={{
                    marginHorizontal: 16,
                    backgroundColor: colors.groupedSurface,
                    borderRadius: 16,
                    paddingVertical: 16,
                    paddingHorizontal: 20,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    minHeight: 56,
                  }}
                >
                  <Ionicons name="laptop-outline" size={20} color={colors.textSecondary} />
                  <Text style={{ ...mobileTypography.body, color: colors.text, flex: 1 }}>
                    {t('listening_archive_target')}
                  </Text>
                  <Text
                    style={{
                      ...mobileTypography.body,
                      color: colors.textSecondary,
                      flexShrink: 1,
                    }}
                  >
                    {machines.find((m) => m.id === recording.targetMachineId)?.name ??
                      recording.targetMachineId ??
                      t('listening_archive_unset')}
                  </Text>
                </View>
              </>
            ) : null}
            {recordingPage === 'days' ? (
              <>
                <RecordingDayList
                  days={days}
                  knownDay={day}
                  transcripts={transcripts}
                  openDay={openDay}
                  active={recording.active}
                />
                {before
                  ? button(
                      t('personal_more_days'),
                      () =>
                        void action(async () => {
                          const page = await authApi<{ days: string[]; nextBefore: string | null }>(
                            `${path}/recording/days?before=${before}`,
                          )
                          setDays((items) =>
                            [...new Set([...items, ...page.days])].sort().reverse(),
                          )
                          setBefore(page.nextBefore)
                        }, false),
                    )
                  : null}
              </>
            ) : null}
            {recordingPage === 'day' ? (
              <>
                <RecordingRoute day={day} />
                <ListeningActions
                  revision={recording.revision}
                  active={recording.active}
                  day={day}
                />
                {candidates
                  .filter((item) => item.day === day)
                  .map((item) => (
                    <View key={item.key} style={box}>
                      <Text style={{ color: colors.text }}>{item.payload.content}</Text>
                      <Text style={{ color: colors.textSecondary }}>
                        {new Date(item.payload.eventTime).toLocaleString()}
                      </Text>
                      {button(
                        t('personal_confirm'),
                        () =>
                          void action(() =>
                            authApi(`${path}/recording/candidates/${item.key}/confirm`, {
                              method: 'POST',
                              body: '{}',
                            }),
                          ),
                      )}
                      {button(
                        t('personal_dismiss'),
                        () =>
                          void action(() =>
                            authApi(`${path}/recording/candidates/${item.key}/dismiss`, {
                              method: 'POST',
                              body: '{}',
                            }),
                          ),
                      )}
                    </View>
                  ))}
                {transcripts.filter((item) => item.day === day).length ? (
                  transcripts
                    .filter((item) => item.day === day)
                    .map((item) => <RecordingTranscript key={item.key} item={item} />)
                ) : (
                  <Text
                    style={{
                      ...mobileTypography.secondary,
                      color: colors.textSecondary,
                      marginVertical: 24,
                    }}
                  >
                    {t('personal_empty')}
                  </Text>
                )}
                {gaps.map((item) => (
                  <View key={item.key} style={{ marginVertical: 12 }}>
                    <Text style={{ color: colors.errorText }}>
                      {t('personal_error_recognition_gap')}
                    </Text>
                    <Text style={{ color: colors.textSecondary }}>
                      {new Date(item.startAt).toLocaleTimeString()} –{' '}
                      {new Date(item.endAt).toLocaleTimeString()}
                    </Text>
                  </View>
                ))}
                {summary ? (
                  <View style={{ marginVertical: 16, gap: 8 }}>
                    <Text style={{ ...mobileTypography.sectionTitle, color: colors.text }}>
                      {t('personal_summary')}
                    </Text>
                    <Text selectable style={{ ...mobileTypography.body, color: colors.text }}>
                      {summary}
                    </Text>
                  </View>
                ) : null}
              </>
            ) : null}
            {recording.targetChanged ? (
              <View style={box}>
                <Text style={{ color: colors.errorText }}>{t('personal_target_changed')}</Text>
                {button(
                  t('personal_confirm_old_target'),
                  () => void action(confirmRecordingOldTarget, false),
                )}
              </View>
            ) : null}
            {recordingPage !== 'home' ? (
              <RecordingSyncNotice
                syncError={recording.syncError}
                archiveError={recording.archiveError}
                assistanceAvailable={recording.assistanceAvailable}
                assist={recording.preferences.mode === 'assist'}
                retry={() =>
                  void action(async () => {
                    await syncModules()
                    await load()
                  }, false)
                }
              />
            ) : null}
            {recording.recognitionPending && recordingPage !== 'home' ? (
              <Text accessibilityLiveRegion="polite" style={{ color: colors.textSecondary }}>
                {t('personal_recognition_pending')}
              </Text>
            ) : null}
            {recording.error && recordingPage !== 'home' ? (
              <Text accessibilityRole="alert" style={{ color: colors.errorText }}>
                {t(`personal_error_${recording.error}`, {
                  defaultValue: t('personal_action_failed'),
                })}
              </Text>
            ) : null}
            {recording.analysisError &&
            recording.preferences.mode === 'assist' &&
            recordingPage !== 'home' ? (
              <Text accessibilityRole="alert" style={{ color: colors.errorText }}>
                {t('listening_analysis_error')}
              </Text>
            ) : null}
          </>
        ) : null}
      </ScrollView>
      {tab === 'recording' && recordingPage === 'home' ? (
        <RecordingCaptureControl
          active={recording.active}
          busy={busy || recording.starting || recording.stopping}
          toggle={() => {
            if (recording.active) void action(stopRecording, false)
            else void confirmRecordingStart().catch(() => setError(true))
          }}
        />
      ) : null}
    </SafeAreaView>
  )
}
