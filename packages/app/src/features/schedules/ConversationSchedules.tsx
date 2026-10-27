// @arch docs/features/conversation-schedules.md
import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, ActivityIndicator, Platform, Pressable, Text, TextInput, View, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { ConversationSchedule, ScheduleAction } from '@shennian/wire'
import { useAuthStore } from '../../config/auth'
import { useTheme } from '../../hooks/useTheme'
import { mobileTypography } from '../../theme/mobileTypography'
import { scheduleClient } from './scheduleClient'
import Ionicons from '@expo/vector-icons/Ionicons'
import BottomSheet from '../../components/BottomSheet'
import { ScheduleExecutionChoice } from './ScheduleExecutionChoice'
import { ScheduleTaskCard } from './ScheduleTaskCard'
import { ScheduleEditorFields } from './ScheduleEditorFields'
import { ScheduleSwipeRow } from './ScheduleSwipeRow'
import { scheduleEditTime } from './schedulePresentation'

export function ConversationSchedules({ sessionId, roomId, stewardMachineId, stewardAllMachines = false, agentNames = {}, machineNames = {}, showHeading = true, desktop = false, embedded = false, alwaysShow = false, personalPresentation = false }: {
  personalPresentation?: boolean
  sessionId?: string; roomId?: string
  /** The steward's tasks on one machine — the machine whose conversation is open. */
  stewardMachineId?: string
  stewardAllMachines?: boolean; agentNames?: Record<string, string>; machineNames?: Record<string, string>
  showHeading?: boolean; desktop?: boolean; embedded?: boolean
  /** The steward settings page is a dedicated "定时任务" entry, not an embedded hint; it stays visible (with an empty state) instead of disappearing at zero tasks. */
  alwaysShow?: boolean
}) {
  const { t, i18n } = useTranslation()
  const { colors } = useTheme()
  // Embedded on a mobile settings page: the surrounding page already indents and separates its rows,
  // so these rows must look like its own rows, not like a slab dropped inside it.
  const inlineRow = embedded && !desktop
  const accountId = useAuthStore(s => s.user?.id)
  const [tasks, setTasks] = useState<ConversationSchedule[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [executionMode, setExecutionMode] = useState<'main' | 'worker'>('main')
  const [prompt, setPrompt] = useState('')
  const [timeDescription, setTimeDescription] = useState('')
  const generation = useRef(0)
  const reload = useCallback(async (silent = false) => {
    const current = ++generation.current
    if (!silent) { setLoading(true); setFailed(false) }
    try {
      const next = await scheduleClient.list({ ...(sessionId ? { sessionId } : {}), ...(roomId ? { roomId } : {}), ...(stewardMachineId ? { stewardMachineId } : {}), ...(stewardAllMachines ? { allSteward: true } : {}) })
      if (current === generation.current) { setTasks(next.filter(task => task.state !== 'ended')); setFailed(false) }
    } catch { if (current === generation.current) setFailed(true) }
    finally { if (current === generation.current) setLoading(false) }
  }, [sessionId, roomId, stewardMachineId, stewardAllMachines, accountId])
  useEffect(() => {
    setTasks([]); setEditing(null)
    void reload()
    return () => { generation.current++ }
  }, [reload])
  useEffect(() => {
    if (editing || busy) return
    const timer = setInterval(() => void reload(true), 15000)
    return () => clearInterval(timer)
  }, [editing, busy, reload])
  const mutate = async (task: ConversationSchedule, action: ScheduleAction) => {
    const current = generation.current
    setBusy(true); setFailed(false)
    try {
      await scheduleClient.mutate(task, action, action === 'update' ? { prompt, ...(task.scope === 'steward' ? { executionMode } : {}), ...(timeDescription !== editTime(task) ? { timeDescription: timeDescription.replace(/^(\d{4}-\d{2}-\d{2}) /, '$1T').replace(/ (?=[+-]\d{2}:\d{2}$)/, '') } : {}) } : {})
      if (current !== generation.current) return
      setEditing(null)
      await reload()
    } catch { if (current === generation.current) setFailed(true) }
    finally { setBusy(false) }
  }
  const closeDetails = (task: ConversationSchedule) => {
    if (busy) return
    if (prompt === task.prompt && timeDescription === editTime(task) && executionMode === (task.executionMode ?? 'main')) { setEditing(null); return }
    if (Platform.OS === 'web') {
      if (globalThis.confirm(t('agents_unsaved_message'))) setEditing(null)
      return
    }
    Alert.alert(t('agents_unsaved_title'), t('agents_unsaved_message'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('agents_discard_changes'), style: 'destructive', onPress: () => setEditing(null) },
    ])
  }
  const button = (label: string, action: () => void, danger = false) => (
    <Pressable accessibilityRole="button" disabled={busy || loading} accessibilityState={{ disabled: busy || loading }} onPress={action} style={[styles.button, personalPresentation && styles.personalButton, { backgroundColor: colors.groupedSurface }]}>
      <Text style={[mobileTypography.body, { color: danger ? colors.errorText : colors.text, opacity: busy ? 0.5 : 1 }]}>{label}</Text>
    </Pressable>
  )
  const editTime = scheduleEditTime
  const displayTime = (task: ConversationSchedule) => task.rule.kind === 'once'
    ? new Intl.DateTimeFormat(i18n.language === 'zh' ? 'zh-CN' : 'en-US', { timeZone: task.timezone, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(task.rule.at)
    : task.timeDescription
  // New-user primary path has no schedule creation UI at all (it's chat-only); once loaded, an agent
  // with zero active schedules shows nothing here instead of a promotional empty-state hint. An agent
  // that already has schedules keeps this section so the existing stop/delete/pause path stays reachable.
  if (!alwaysShow && !loading && !failed && tasks.length === 0) return null
  if (embedded && (loading || failed)) return <View style={[styles.embeddedSummary, inlineRow && styles.inlineGutter, { borderTopColor: colors.groupedSeparator }]}>
    <View style={styles.embeddedCopy}>
      <Text style={[styles.embeddedTitle, { color: colors.text }]}>{t('schedules_title')}</Text>
      {!loading ? <Text style={[styles.embeddedHint, { color: colors.textSecondary }]}>{t('schedules_failed')}</Text> : null}
    </View>
    {loading ? <ActivityIndicator accessibilityLabel={t('loading')} /> : null}
    {failed ? <Pressable accessibilityRole="button" accessibilityLabel={t('retry')} onPress={() => void reload()} style={styles.embeddedRetry}><Text style={{ color: colors.navigationSelected }}>{t('retry')}</Text></Pressable> : null}
  </View>
  return <View style={[styles.section, personalPresentation && styles.personalSection, desktop && styles.desktopSection, embedded && styles.embeddedSection, { backgroundColor: embedded || personalPresentation ? 'transparent' : colors.groupedSurface }]}>
    {personalPresentation && !loading && !failed && tasks.length > 0 ? <View style={styles.overview}><Text style={[mobileTypography.sectionTitle, { color: colors.text }]}>{t('schedules_overview_title')}</Text><Text style={[mobileTypography.secondary, { color: colors.textSecondary }]}>{t('schedules_overview_hint')}</Text></View> : null}
    {showHeading ? <Text style={[styles.heading, desktop && styles.desktopHeading, embedded && styles.embeddedHeading, inlineRow && styles.inlineHeading, { color: colors.text, borderBottomColor: colors.groupedSeparator, borderTopColor: colors.groupedSeparator }]}>{t('schedules_title')}</Text> : null}
    {loading ? <ActivityIndicator accessibilityLabel={t('loading')} /> : null}
    {failed ? <View><Text style={{ color: colors.textSecondary }}>{t('schedules_failed')}</Text>{button(t('retry'), () => void reload())}</View> : null}
    {alwaysShow && !loading && !failed && tasks.length === 0
      ? personalPresentation ? <View style={styles.empty}><Ionicons name="time-outline" size={32} color={colors.textMuted} /><Text style={[mobileTypography.sectionTitle, { color: colors.text }]}>{t('schedules_empty')}</Text><Text style={[mobileTypography.secondary, { color: colors.textSecondary, textAlign: 'center' }]}>{t('schedules_hint')}</Text></View> : <Text style={[styles.row, inlineRow && styles.inlineEmpty, mobileTypography.secondary, { color: colors.textSecondary, borderBottomColor: colors.groupedSeparator, borderBottomWidth: 0 }]}>{t('schedules_hint')}</Text> : null}
    {tasks.map((task, index) => <ScheduleSwipeRow key={task.id} disabled={busy || loading || editing === task.id}
      paused={task.state === 'paused'} canPause={task.rule.kind !== 'once' && (task.state === 'active' || task.state === 'paused')}
      onToggle={() => void mutate(task, task.state === 'paused' ? 'resume' : 'pause')}
      onDelete={() => void mutate(task, 'delete')}>
      <View style={[!personalPresentation && styles.row, inlineRow && styles.inlineTaskRow, {
        borderBottomWidth: !personalPresentation && index < tasks.length - 1 ? (inlineRow ? StyleSheet.hairlineWidth : 1) : 0,
        borderColor: colors.groupedSeparator,
        backgroundColor: personalPresentation ? 'transparent' : inlineRow ? colors.bg : colors.surface,
      }]}>
      <BottomSheet isOpen={editing === task.id} onClose={() => closeDetails(task)} title={t('schedules_title')} closeButtonStyle="icon" bodyBackgroundColor={colors.groupedBackground}
        headerLeft={<Pressable accessibilityRole="button" accessibilityLabel={t('save')}
          disabled={busy || !prompt.trim() || !timeDescription.trim() || (prompt === task.prompt && timeDescription === editTime(task) && executionMode === (task.executionMode ?? 'main'))}
          onPress={() => void mutate(task, 'update')} style={styles.headerSave}>
          <Text style={[mobileTypography.body, { color: colors.navigationSelected, opacity: busy || !prompt.trim() || !timeDescription.trim() || (prompt === task.prompt && timeDescription === editTime(task) && executionMode === (task.executionMode ?? 'main')) ? 0.4 : 1 }]}>{t('save')}</Text>
        </Pressable>}>

      <View style={[styles.detail, { backgroundColor: colors.groupedBackground }]}>
        {failed ? <Text accessibilityRole="alert" style={{ color: colors.errorText }}>{t('schedules_failed')}</Text> : null}
        {personalPresentation ? <ScheduleEditorFields task={task} machineName={task.machineId ? machineNames[task.machineId] : undefined} prompt={prompt} onPromptChange={setPrompt} time={timeDescription} onTimeChange={setTimeDescription} executionMode={executionMode} onExecutionChange={setExecutionMode} busy={busy} /> : <>
        {task.scope === 'steward' ? <ScheduleExecutionChoice value={executionMode} onChange={setExecutionMode} disabled={busy} /> : null}
        {task.last ? <Text style={[styles.text, { color: colors.textSecondary }]}>{t(`schedules_last_${task.last.state}`)}</Text> : null}
        <Text style={[styles.text, { color: colors.textSecondary }]}>{t('schedules_work')}</Text>
        <TextInput accessibilityLabel={t('schedules_work')} editable={!busy} value={prompt} onChangeText={setPrompt} multiline style={[styles.input, { color: colors.text, backgroundColor: colors.groupedSurface }]} />
        <Text style={[styles.text, { color: colors.textSecondary }]}>{t('schedules_time')} · {t(`schedules_kind_${task.rule.kind}`)}</Text>
        <TextInput accessibilityLabel={t('schedules_time')} editable={!busy} value={timeDescription} onChangeText={setTimeDescription} style={[styles.input, { color: colors.text, backgroundColor: colors.groupedSurface }]} />
        </>}
        <View style={[styles.actions, personalPresentation && styles.personalActions]}>
          {task.rule.kind !== 'once' && (task.state === 'active' || task.state === 'paused') ? button(t(task.state === 'active' ? 'schedules_pause' : 'schedules_resume'), () => void mutate(task, task.state === 'active' ? 'pause' : 'resume')) : null}
          {button(t('delete'), () => void mutate(task, 'delete'), true)}
        </View>
        {personalPresentation ? <Text style={[mobileTypography.metadata, { color: colors.textMuted }]}>{t('schedules_future_only')}</Text> : null}
      </View></BottomSheet>
      {personalPresentation ? <ScheduleTaskCard task={task} time={displayTime(task)} machineName={task.machineId ? machineNames[task.machineId] : undefined} disabled={busy || loading} onPress={() => { setEditing(task.id); setExecutionMode(task.executionMode ?? 'main'); setPrompt(task.prompt); setTimeDescription(editTime(task)) }} /> : <Pressable disabled={busy || loading} accessibilityState={{ disabled: busy || loading }} accessibilityRole="button" accessibilityLabel={`${task.prompt}, ${displayTime(task)}, ${t(`schedules_state_${task.state}`)}`} onPress={() => { setEditing(task.id); setExecutionMode(task.executionMode ?? 'main'); setPrompt(task.prompt); setTimeDescription(editTime(task)) }}>
        <View style={styles.taskLine}>
        <View style={styles.taskContent}>
          <Text numberOfLines={1} ellipsizeMode="tail" style={[mobileTypography.body, { color: task.state === 'paused' ? colors.textSecondary : colors.text, flex: 1 }]}>{task.prompt}</Text>

          <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.caption, { color: colors.textSecondary }]}>{[task.state === 'paused' ? t('schedules_state_paused') : null, displayTime(task), task.scope === 'steward' ? t(`schedules_execution_${task.executionMode ?? 'main'}`) : null, roomId && task.agentIdentityId ? agentNames[task.agentIdentityId] : null, stewardAllMachines && task.machineId ? machineNames[task.machineId] : null].filter(Boolean).join(' · ')}</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
        </View>
      </Pressable>}
    </View></ScheduleSwipeRow>)}
  </View>
}
const styles = StyleSheet.create({
  personalSection: { marginVertical: 24, borderRadius: 0, overflow: 'visible' },
  empty: { paddingHorizontal: 24, paddingVertical: 40, alignItems: 'center', gap: 12 },
  overview: { gap: 6, marginBottom: 22 }, personalActions: { flexDirection: 'row', marginTop: 22 }, personalButton: { flex: 1, borderRadius: 12 },
  section: { marginVertical: 24, borderRadius: 10, overflow: 'hidden' }, desktopSection: { marginVertical: 0 },
  // No rounded corners to clip in embedded mode; keep content visible even if it
  // grows after the first layout pass (e.g. the alwaysShow hint, added once loading
  // settles) instead of inheriting section's overflow:hidden clip rect.
  embeddedSection: { borderRadius: 0, overflow: 'visible' }, heading: { ...mobileTypography.body, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1 }, desktopHeading: {fontSize: 14, lineHeight: 20, fontWeight: '500', paddingVertical: 8, borderBottomWidth: 0}, embeddedHeading: { minHeight: 44, paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth }, text: mobileTypography.secondary,
  embeddedSummary: { minHeight: 60, paddingLeft: 14, paddingRight: 8, paddingVertical: 9, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 8 },
  embeddedCopy: { flex: 1, minWidth: 0, gap: 2 }, embeddedTitle: { fontSize: 14, lineHeight: 20, fontWeight: '500' }, embeddedHint: { fontSize: 12, lineHeight: 17 }, embeddedRetry: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  // Mobile-embedded geometry: no gutter of its own, and the same row height and
  // hairline separators the hosting settings page uses.
  inlineGutter: { paddingLeft: 0, paddingRight: 0 },
  inlineHeading: { paddingHorizontal: 0, borderBottomWidth: StyleSheet.hairlineWidth },
  inlineTaskRow: { paddingHorizontal: 0, minHeight: 60, justifyContent: 'center' },
  inlineEmpty: { paddingHorizontal: 0, minHeight: 60, paddingVertical: 20 },
  taskLine: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  taskContent: { flex: 1, gap: 4 },
  detail: { paddingVertical: 20, gap: 8 }, caption: mobileTypography.metadata, headerSave: { minHeight: 44, minWidth: 48, justifyContent: 'center' },
  row: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, gap: 4 },
  input: { borderRadius: 10, padding: 16, marginBottom: 12, minHeight: 52, ...mobileTypography.body },
  actions: { gap: 12, marginVertical: 8 }, button: { borderRadius: 10, minHeight: 52, minWidth: 48, padding: 12, alignItems: 'center', justifyContent: 'center' },
})
