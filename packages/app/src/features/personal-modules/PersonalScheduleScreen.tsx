import { useContextualSteward } from '../steward/ContextualStewardContext'
// @arch docs/features/personal-modules.md
// @test src/__tests__/personal-schedule.test.ts
import { useCallback, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  AppState,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import { AppPageHeader, HeaderIconButton } from '../../components/AppPageHeader'
import { useMobileModuleBack } from '../../components/useMobileModuleBack'
import { useTheme } from '../../hooks/useTheme'
import { useAuthStore } from '../../config/auth'
import { authApi } from '../../config/api'
import { mobileTypography } from '../../theme/mobileTypography'
import { ScheduleComposer } from './ScheduleComposer'
import { PersonalScheduleSwipeRow } from './PersonalScheduleSwipeRow'
import { useScheduleDisplay } from './useScheduleDisplay'
import { moduleStore } from './runtime'
import { localDay, localZone, type Reminder } from './types'
import {
  monthCells,
  reminderDate,
  schedulePresentation,
  scheduleGroups,
  groupRecurrence,
} from './scheduleModel'
const path = '/personal-modules/reminders'
export default function PersonalScheduleScreen(props: { initialText?: string }) {
  const accountId = useAuthStore((s) => s.user?.id ?? '')
  // Reset private state only on account changes, never on navigation focus.
  return <AccountScheduleScreen key={accountId} accountId={accountId} {...props} />
}
function AccountScheduleScreen({
  accountId,
  initialText,
}: {
  accountId: string
  initialText?: string
}) {
  const contextual = useContextualSteward()
  const { t, i18n } = useTranslation()
  const { colors } = useTheme()
  const back = useMobileModuleBack()
  const router = useRouter()
  const [items, setItems] = useState<Reminder[]>([])
  const { display } = useScheduleDisplay()
  const [selectedDay, setSelectedDay] = useState(localDay())
  const [month, setMonth] = useState(() => new Date())
  const [loading, setLoading] = useState(false)
  const [offline, setOffline] = useState(false)
  const [error, setError] = useState(false)
  const [before, setBefore] = useState<string | null>(null)
  const [edit, setEdit] = useState<Reminder | null>(null)
  const [text, setText] = useState('')
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const mutation = useRef(false)
  const epoch = useRef(0)
  const pages = useRef(1)
  const hydrated = useRef(false)
  const load = useCallback(
    async (quiet = false) => {
      if (!accountId) return
      const current = ++epoch.current
      const live = () => epoch.current === current && useAuthStore.getState().user?.id === accountId
      if (!quiet) setLoading(true)
      try {
        const store = await moduleStore()
        if (!live()) return
        // Hydrate once; reapplying disk snapshots during sync can flash stale rows.
        if (!hydrated.current) {
          const cached = await store.cached<Reminder[]>('schedule:list')
          if (!live()) return
          if (cached) setItems(cached)
          hydrated.current = true
        }
        let cursor: string | null = null
        const loaded: Reminder[] = []
        for (let i = 0; i < pages.current; i++) {
          const page: { items: Reminder[] } = await authApi(
            `${path}${cursor ? `?before=${encodeURIComponent(cursor)}` : ''}`,
          )
          if (!live()) return
          loaded.push(...page.items.slice(0, 200))
          cursor = page.items.length > 200 ? page.items[199]!.key : null
          if (!cursor) break
        }
        setItems(loaded)
        setBefore(cursor)
        setOffline(false)
        await store.cache('schedule:list', loaded)
      } catch {
        if (live()) setOffline(true)
      } finally {
        if (live()) setLoading(false)
      }
    },
    [accountId],
  )
  useFocusEffect(
    useCallback(() => {
      setLoading(false)
      setEdit(null)
      setText('')
      setError(false)
      void load(true)
      // Other entry points may add reminders. Refresh only while visible.
      const timer = setInterval(() => {
        if (AppState.currentState === 'active') void load(true)
      }, 10000)
      const active = AppState.addEventListener('change', (state) => {
        if (state === 'active') void load(true)
      })
      return () => {
        epoch.current++
        clearInterval(timer)
        active.remove()
      }
    }, [load]),
  )
  async function mutate(work: () => Promise<unknown>) {
    if (mutation.current) return
    mutation.current = true
    setBusy(true)
    setError(false)
    try {
      await work()
      await load(true)
    } catch {
      setError(true)
      await load(true) // A legacy group may have partially succeeded; show actual revisions.
    } finally {
      mutation.current = false
      setBusy(false)
    }
  }
  const saveEdit = () => {
    if (!edit || mutation.current) return
    const item = edit,
      value = text.trim()
    if (!value || value === `${item.payload.when} ${item.payload.content}`.trim()) {
      setEdit(null)
      return
    }
    void mutate(async () => {
      const parsed = await authApi<{ content: string; when: string }>(`${path}/preview`, {
        method: 'POST',
        body: JSON.stringify({ text: value, timezone: item.payload.timezone || localZone() }),
      })
      if (useAuthStore.getState().user?.id !== accountId) return
      await authApi(`${path}/${encodeURIComponent(item.key)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          ...parsed,
          timezone: item.payload.timezone || localZone(),
          revision: item.revision,
        }),
      })
      setEdit((current) => (current?.key === item.key ? null : current))
    })
  }
  const changeState = (item: Reminder, state: string, members = [item]) =>
    void mutate(async () => {
      for (const member of members) {
        if (useAuthStore.getState().user?.id !== accountId) return
        await authApi(`${path}/${encodeURIComponent(member.key)}`, {
          method: 'PATCH',
          body: JSON.stringify({ state, revision: member.revision }),
        })
      }
    })
  const confirmDelete = (item: Reminder, members = [item]) =>
    Alert.alert(
      t('delete'),
      [schedulePresentation(item, i18n.language).title, t('personal_schedule_entire_item')].join(
        '\n',
      ),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('delete'),
          style: 'destructive',
          onPress: () => changeState(item, 'deleted', members),
        },
      ],
    )
  const editItem = (item: Reminder) => {
    setEdit(item)
    setText(`${item.payload.when} ${item.payload.content}`.trim())
  }
  const editGroup = (item: Reminder, members: Reminder[]) => {
    if (members.length === 1) return editItem(item)
    setExpandedGroup((current) => (current === item.key ? null : item.key))
  }
  const rows = scheduleGroups(items, display, selectedDay)
  const header = (
    <AppPageHeader
      title={t('personal_reminders')}
      onBack={back}
      trailing={
        <HeaderIconButton
          icon="ellipsis-horizontal"
          label={t('personal_schedule_display')}
          onPress={() => router.push('/(main)/schedule-display')}
        />
      }
    />
  )
  const content = (
    <View style={styles.content}>
      {offline || error ? (
        <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.status}>
          <Text
            accessibilityRole={error ? 'alert' : undefined}
            style={{ color: error ? colors.errorText : colors.textSecondary }}
          >
            {t(error ? 'personal_action_failed' : 'personal_schedule_offline')}
          </Text>
        </Pressable>
      ) : null}
      <ScrollView
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} />}
        contentContainerStyle={styles.list}
      >
        {display.mode === 'calendar' ? (
          <View>
            {display.range === 'all' ? (
              <>
                <View style={styles.month}>
                  <HeaderIconButton
                    icon="chevron-back"
                    label={t('personal_schedule_previous_month')}
                    onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
                  />
                  <Text style={{ ...mobileTypography.sectionTitle, color: colors.text }}>
                    {month.toLocaleDateString(i18n.language, { year: 'numeric', month: 'long' })}
                  </Text>
                  <HeaderIconButton
                    icon="chevron-forward"
                    label={t('personal_schedule_next_month')}
                    onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
                  />
                </View>
                <View style={styles.grid}>
                  {Array.from({ length: 7 }, (_, i) => (
                    <View key={i} style={styles.cell}>
                      <Text style={{ color: colors.textSecondary }}>
                        {new Date(2026, 9, 19 + i).toLocaleDateString(i18n.language, {
                          weekday: 'short',
                        })}
                      </Text>
                    </View>
                  ))}
                </View>
                <View style={styles.grid}>
                  {monthCells(month).map((date, i) => (
                    <Pressable
                      key={date ?? `blank-${i}`}
                      disabled={!date}
                      accessibilityRole="button"
                      accessibilityLabel={date ?? undefined}
                      accessibilityState={{ selected: date === selectedDay }}
                      onPress={() => date && setSelectedDay(date)}
                      style={[
                        styles.cell,
                        {
                          backgroundColor: date === selectedDay ? colors.brand : undefined,
                          borderRadius: 12,
                        },
                      ]}
                    >
                      <Text
                        style={{
                          color:
                            date === selectedDay
                              ? '#ffffff'
                              : date === localDay()
                                ? colors.brand
                                : colors.text,
                        }}
                      >
                        {date ? Number(date.slice(-2)) : ''}
                      </Text>
                      {date &&
                      items.some(
                        (item) =>
                          item.state !== 'deleted' &&
                          item.state !== 'completed' &&
                          reminderDate(item) &&
                          localDay(reminderDate(item)!) === date,
                      ) ? (
                        <View
                          style={[
                            styles.dot,
                            { backgroundColor: date === selectedDay ? '#ffffff' : colors.brand },
                          ]}
                        />
                      ) : null}
                    </Pressable>
                  ))}
                </View>
              </>
            ) : null}
            <View style={styles.month}>
              <Text style={{ ...mobileTypography.sectionTitle, color: colors.text }}>
                {display.range === 'today' ? localDay() : selectedDay}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setMonth(new Date())
                  setSelectedDay(localDay())
                }}
                style={styles.status}
              >
                <Text style={{ color: colors.brand }}>{t('personal_schedule_today')}</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
        {rows.map(({ item, members }) => {
          const presentation = schedulePresentation(item, i18n.language)
          const recurrence = groupRecurrence(members, i18n.language) ?? presentation.recurrence
          const deliveryError = members.some((member) => member.payload.deliveryError)
          return (
            <PersonalScheduleSwipeRow
              key={item.key}
              disabled={busy || edit !== null}
              completed={item.state === 'completed'}
              onToggle={() =>
                changeState(item, item.state === 'completed' ? 'active' : 'completed', members)
              }
              onDelete={() => confirmDelete(item, members)}
            >
              <View
                style={[
                  styles.row,
                  {
                    backgroundColor: colors.bg,
                    borderBottomColor: colors.separator ?? colors.border,
                  },
                ]}
              >
                {members.some((member) => member.key === edit?.key) ? (
                  <TextInput
                    autoFocus
                    multiline
                    editable={!busy}
                    accessibilityLabel={t('personal_edit')}
                    value={text}
                    onChangeText={setText}
                    onBlur={saveEdit}
                    onSubmitEditing={saveEdit}
                    submitBehavior="blurAndSubmit"
                    style={[styles.edit, { color: colors.text }]}
                  />
                ) : (
                  <Pressable
                    disabled={busy}
                    accessibilityRole="button"
                    onPress={() => editGroup(item, members)}
                    onLongPress={() => confirmDelete(item, members)}
                    accessibilityLabel={[presentation.title, presentation.time, recurrence]
                      .filter(Boolean)
                      .join(', ')}
                    accessibilityActions={[
                      {
                        name: 'toggle',
                        label: t(
                          item.state === 'completed' ? 'personal_restore' : 'personal_complete',
                        ),
                      },
                      { name: 'delete', label: t('delete') },
                    ]}
                    onAccessibilityAction={({ nativeEvent }) => {
                      if (busy || edit) return
                      if (nativeEvent.actionName === 'toggle')
                        changeState(
                          item,
                          item.state === 'completed' ? 'active' : 'completed',
                          members,
                        )
                      if (nativeEvent.actionName === 'delete') confirmDelete(item, members)
                    }}
                    style={styles.rowBody}
                  >
                    <Text
                      style={[
                        mobileTypography.listTitle,
                        {
                          color: item.state === 'completed' ? colors.textSecondary : colors.text,
                          textDecorationLine: item.state === 'completed' ? 'line-through' : 'none',
                        },
                      ]}
                    >
                      {presentation.title}
                    </Text>
                    {presentation.time || deliveryError ? (
                      <Text
                        style={[
                          mobileTypography.metadata,
                          {
                            color: deliveryError ? colors.errorText : colors.textSecondary,
                          },
                        ]}
                      >
                        {presentation.time}
                        {deliveryError
                          ? `${presentation.time ? ' · ' : ''}${t('personal_push_failed')}`
                          : ''}
                      </Text>
                    ) : null}
                    {recurrence ? (
                      <Text style={[mobileTypography.metadata, { color: colors.textSecondary }]}>
                        {recurrence}
                      </Text>
                    ) : null}
                  </Pressable>
                )}
                {expandedGroup === item.key && !edit && members.length > 1 ? (
                  <View style={{ paddingBottom: 12, gap: 4 }}>
                    <Text style={[mobileTypography.metadata, { color: colors.textSecondary }]}>
                      {t('personal_schedule_choose_time')}
                    </Text>
                    {members.map((member) => (
                      <Pressable
                        key={member.key}
                        disabled={busy}
                        onPress={() => editItem(member)}
                        style={{ minHeight: 44, justifyContent: 'center' }}
                      >
                        <Text style={[mobileTypography.body, { color: colors.brand }]}>
                          {member.payload.when}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
                {busy && edit?.key === item.key ? <ActivityIndicator color={colors.brand} /> : null}
              </View>
            </PersonalScheduleSwipeRow>
          )
        })}
        {before ? (
          <Pressable
            accessibilityRole="button"
            disabled={loading}
            style={styles.status}
            onPress={() => {
              pages.current++
              void load()
            }}
          >
            <Text style={{ color: colors.brand }}>{t('personal_more')}</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  )
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      {header}
      <KeyboardAvoidingView
        enabled={!contextual}
        style={{ flex: 1 }}
        behavior={Platform.OS === 'android' ? 'height' : 'padding'}
      >
        {content}
        {!contextual && (
          <ScheduleComposer
            key={accountId}
            initialText={initialText}
            onCreated={() => load(true)}
          />
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}
const styles = StyleSheet.create({
  content: { flex: 1 },
  list: { paddingHorizontal: 16, paddingBottom: 24 },
  status: { padding: 12, minHeight: 44 },
  row: {
    flexDirection: 'column',
    alignItems: 'stretch',
    minHeight: 70,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowBody: { flex: 1, paddingVertical: 12, gap: 4 },
  edit: { flex: 1, minHeight: 48, ...mobileTypography.body, paddingVertical: 12 },
  month: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: {
    width: '14.2857%',
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  dot: { width: 4, height: 4, borderRadius: 2 },
})
