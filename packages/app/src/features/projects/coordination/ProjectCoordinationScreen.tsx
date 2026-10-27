// @arch docs/design/project-coordination-ios.md
// @test src/__tests__/project-coordination.test.ts
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTranslation } from 'react-i18next'
import { formatSessionPreviewForDisplay, useMachinesStore, useProjectsStore } from '@shennian/shared'
import { AppPageHeader } from '../../../components/AppPageHeader'
import { useTheme } from '../../../hooks/useTheme'
import { mobileTypography } from '../../../theme/mobileTypography'
import { useComposerBottomInset } from '../../chat/hooks/useComposerBottomInset'
import { useProjectCoordination } from './useProjectCoordination'
import { ProjectCoordinationComposer } from './ProjectCoordinationComposer'
import { ProjectCoordinationSettings } from './ProjectCoordinationSettings'
import { coordinationErrorMessageKey, pendingCoordinationQuestions, type CoordinationSnapshot } from './client'

/** The open manager conversation keeps its previous near-live cadence. */
import { SimpleMessageMarkdown } from '../../../components/chat/SimpleMessageMarkdown'
import { ProjectCoordinationQuestionCard } from './ProjectCoordinationQuestions'

const CHAT_REFRESH_MS = 5_000
const SETTINGS_REFRESH_MS = 30_000

function Message({ text, tasks }: { text: string; tasks: CoordinationSnapshot['tasks'] }) {
  const router = useRouter(), { colors } = useTheme()
  const parts = text.split(/(\[[^\]]+\]\(shennian:\/\/session\/[\w.:-]+\)|shennian:\/\/session\/[\w.:-]+)/g)
  const { t } = useTranslation()
  const title = (value: string) => formatSessionPreviewForDisplay(value, { image: t('session_preview_image'), images: () => t('session_preview_image'), file: t('session_preview_file'), files: () => t('session_preview_file') }).slice(0, 80)
  return <View style={{ gap: 4 }}>{parts.map((part, i) => {
    const id = /shennian:\/\/session\/([\w.:-]+)/.exec(part)?.[1]
    const task = tasks.find(t => t.id === id)
    return task ? <Pressable key={i} accessibilityRole="link" onPress={() => router.push(`/(main)/chat/${task.id}`)}><Text style={[mobileTypography.body, { color: colors.navigationSelected ?? colors.brand }]}>{title(task.title)} ›</Text></Pressable>
      : <SimpleMessageMarkdown key={i} content={part} color={colors.text} linkColor={colors.navigationSelected ?? colors.brand} codeBackground={colors.surface} typography={mobileTypography.body} />
  })}</View>
}

export default function ProjectCoordinationScreen() {
  const { machineId = '', workDir = '' } = useLocalSearchParams<{ machineId: string; workDir: string }>()
  const router = useRouter(), { t } = useTranslation(), { colors } = useTheme()
  const machine = useMachinesStore(s => s.machines.find(m => m.id === machineId))
  const project = useProjectsStore(s => s.projects.find(p => p.machineId === machineId && p.workDir === workDir))
  const [page, setPage] = useState<'chat' | 'settings' | 'instructions' | 'recent'>('chat')
  const refreshMs = page === 'chat' ? CHAT_REFRESH_MS : SETTINGS_REFRESH_MS
  const { state, error, request } = useProjectCoordination(machineId, workDir, machine?.online === true, {
    maxAgeMs: refreshMs,
    intervalMs: refreshMs,
  })
  const [draft, setDraft] = useState(''), [saving, setSaving] = useState(false)
  const revision = useRef(0), scroll = useRef<ScrollView>(null)
  const bottom = useComposerBottomInset(useSafeAreaInsets().bottom)
  const accent = colors.navigationSelected ?? colors.brand
  const grouped = colors.groupedBackground ?? colors.surface
  const unavailable = !state || !machine?.online || Boolean(error)
  const loading = !state && !error
  const projectLabel = [machine?.name, project?.displayName || workDir.split(/[\\/]/).filter(Boolean).slice(-1)[0]].filter(Boolean).join(' · ')
  useEffect(() => {
    if (state && page !== 'instructions') { setDraft(state.instructions); revision.current = state.instructionRevision }
  }, [state?.instructionRevision, page])
  const invoke = async (input: Record<string, unknown>) => {
    try { return await request(input) }
    catch (error) { Alert.alert(t('coordination_action_failed'), t(coordinationErrorMessageKey(error))); return null }
  }
  const configure = (patch: Record<string, unknown>) => void invoke({ command: 'configure', patch })
  const close = () => {
    if (page === 'instructions' && draft !== state?.instructions) {
      Alert.alert(t('coordination_instructions'), t('coordination_discard_hint'), [
        { text: t('cancel'), style: 'cancel' },
        { text: t('coordination_discard'), style: 'destructive', onPress: () => setPage('settings') },
      ]); return
    }
    if (page === 'chat') router.back()
    else setPage(page === 'settings' ? 'chat' : 'settings')
  }
  const save = async () => {
    setSaving(true)
    const result = await invoke({ command: 'instructions', text: draft, expectedRevision: revision.current })
    setSaving(false)
    if (result) setPage('settings')
  }
  const status = t(!machine?.online ? 'coordination_offline_short' : error ? 'coordination_unavailable_short' : !state ? 'coordination_connecting' : !state.enabled ? 'coordination_disabled' : state.paused ? 'coordination_paused' : pendingCoordinationQuestions(state).length ? 'coordination_needs_answer_short' : state.managerBusy ? 'coordination_busy_short' : 'coordination_active')
  const hasMessages = Boolean(state?.messages.length)
  const title = t(page === 'chat' ? 'coordination_manager' : page === 'settings' ? 'coordination_settings' : page === 'instructions' ? 'coordination_instructions' : 'coordination_recent')

  return <SafeAreaView edges={['top']} style={[styles.root, { backgroundColor: page === 'chat' ? colors.bg : grouped }]}>
    <AppPageHeader title={title} subtitle={page === 'chat' ? projectLabel : undefined} onBack={close} sideWidth={64}
      backgroundColor={page === 'chat' ? colors.bg : grouped} hideDivider={page !== 'chat'} trailing={
        page === 'chat' ? <Pressable accessibilityRole="button" accessibilityLabel={t('coordination_settings')} onPress={() => setPage('settings')} style={styles.headerAction}>
          <Text style={[mobileTypography.body, { color: accent }]}>{t('settings')}</Text>
        </Pressable> : page === 'instructions' ? <Pressable accessibilityRole="button" disabled={saving || unavailable || !draft.trim()} onPress={() => void save()} style={styles.headerAction}>
          {saving ? <ActivityIndicator color={accent} /> : <Text style={[mobileTypography.compactAction, { color: accent }]}>{t('save')}</Text>}
        </Pressable> : null
      } />
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      {page === 'settings' ? <ScrollView contentContainerStyle={{ paddingBottom: bottom }}>
        <ProjectCoordinationSettings state={state} unavailable={unavailable} loading={loading} status={status} onConfigure={configure} onInstructions={() => setPage('instructions')} onRecent={() => setPage('recent')} />
      </ScrollView> : page === 'instructions' ? <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.editorPage, { paddingBottom: bottom }]}>
        <Text style={[mobileTypography.secondary, { color: colors.textMuted }]}>{t('coordination_instructions_hint')}</Text>
        <TextInput value={draft} onChangeText={setDraft} multiline editable={!saving} accessibilityLabel={t('coordination_instructions')} style={[styles.editor, { color: colors.text, backgroundColor: colors.groupedSurface ?? colors.bg }]} />
        <Text style={[mobileTypography.metadata, { color: colors.textMuted }]}>{t('coordination_instructions_footer')}</Text>
      </ScrollView> : page === 'recent' ? <ScrollView contentContainerStyle={[styles.editorPage, { paddingBottom: bottom }]}>
        <View style={[styles.history, { backgroundColor: colors.groupedSurface ?? colors.bg }]}>
          {state?.recent?.length ? [...state.recent].reverse().map(event => <View key={event.sequence} style={[styles.historyRow, { borderBottomColor: colors.groupedSeparator ?? colors.border }]}>
            <Text style={[mobileTypography.secondary, { color: colors.text }]}>{t(event.kind === 'instructions' ? 'coordination_rules_updated' : event.kind === 'enqueue' ? 'coordination_task_received' : 'coordination_arrangement_updated')}</Text>
            <Text style={[mobileTypography.metadata, { color: colors.textMuted }]}>{new Date(event.at).toLocaleString()}</Text>
          </View>) : <Text style={[styles.historyRow, mobileTypography.secondary, { color: colors.textMuted }]}>{t('coordination_no_arrangements')}</Text>}
        </View>
      </ScrollView> : <>
        <View style={[styles.status, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
          <View style={styles.statusLabel}><View style={[styles.dot, { backgroundColor: state?.enabled && !state.paused && !unavailable ? colors.success : colors.textTertiary }]} /><Text style={[mobileTypography.secondary, { color: colors.textMuted }]}>{status}</Text></View>
          {state?.enabled ? <Pressable accessibilityRole="button" disabled={unavailable} style={styles.statusAction} onPress={() => configure({ paused: !state.paused })}><Text style={[mobileTypography.secondary, { color: accent }]}>{t(state.paused ? 'coordination_resume' : 'coordination_pause_short')}</Text></Pressable> : null}
        </View>
        {hasMessages && state?.questions === undefined ? <Text style={[mobileTypography.metadata, { paddingHorizontal: 16, paddingVertical: 8, color: colors.textMuted }]}>{t('coordination_legacy_questions')}</Text> : null}
        {pendingCoordinationQuestions(state).length ? <ScrollView style={{ maxHeight: 300, flexGrow: 0 }} keyboardShouldPersistTaps="handled" accessibilityLabel={t('coordination_question_title')}>
          {pendingCoordinationQuestions(state).map(question => <ProjectCoordinationQuestionCard key={question.id} question={question} disabled={unavailable || !state?.enabled} onAnswer={(id, answer) => request({ command: 'answer', questionId: id, text: answer })} />)}
        </ScrollView> : null}
        <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.messages, !hasMessages && styles.emptyMessages]} onContentSizeChange={() => hasMessages && scroll.current?.scrollToEnd({ animated: true })}>
          {!hasMessages ? <View style={styles.empty}>
            <View style={[styles.emptyIcon, { backgroundColor: colors.ownMessage }]}><Ionicons name={error || !machine?.online ? 'cloud-offline-outline' : 'chatbubbles-outline'} size={28} color={accent} /></View>
            <Text style={[mobileTypography.sectionTitle, styles.centerText, { color: colors.text }]}>{t(error ? 'coordination_unavailable_title' : !machine?.online ? 'coordination_offline_short' : state?.enabled ? 'coordination_chat_empty_title' : 'coordination_welcome_title')}</Text>
            <Text style={[mobileTypography.secondary, styles.centerText, { color: colors.textMuted, lineHeight: 23 }]}>{t(error ? 'coordination_error' : !machine?.online ? 'coordination_offline' : state?.enabled ? 'coordination_chat_empty_body' : 'coordination_welcome_body')}</Text>
            {error ? <Pressable accessibilityRole="button" style={styles.emptyAction} onPress={() => void request({ command: 'get' }).catch(() => {})}><Text style={[mobileTypography.compactAction, { color: accent }]}>{t('coordination_retry')}</Text></Pressable>
              : state && !state.enabled ? <Pressable accessibilityRole="button" style={[styles.enable, { backgroundColor: accent }]} onPress={() => setPage('settings')}><Text style={[mobileTypography.compactAction, { color: '#fff' }]}>{t('coordination_enable_action')}</Text></Pressable> : null}
          </View> : state?.messages.map(m => <View key={m.id} style={[styles.message, { backgroundColor: m.role === 'user' ? colors.ownMessage : colors.surfaceHover, alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start' }]}><Message text={m.text} tasks={state.tasks} /></View>)}
          {state?.managerBusy ? <View style={styles.thinking}><ActivityIndicator size="small" color={colors.textMuted} /><Text style={[mobileTypography.secondary, { color: colors.textMuted }]}>{t('coordination_loading')}</Text></View> : null}
          {state?.managerError ? <Text style={[mobileTypography.secondary, { color: colors.errorText ?? colors.error }]}>{t('coordination_model_error')}</Text> : null}
        </ScrollView>
        {state?.enabled ? <ProjectCoordinationComposer machineId={machineId} workDir={workDir} bottom={bottom} onSent={() => void invoke({ command: 'get' })} /> : null}
      </>}
    </KeyboardAvoidingView>
  </SafeAreaView>
}

const styles = StyleSheet.create({
  root: { flex: 1 }, headerAction: { minHeight: 48, paddingHorizontal: 12, justifyContent: 'center' },
  status: { minHeight: 48, paddingLeft: 20, paddingRight: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth },
  statusLabel: { flexDirection: 'row', gap: 8, alignItems: 'center', flex: 1 }, dot: { width: 7, height: 7, borderRadius: 4 }, statusAction: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12 },
  messages: { padding: 16, paddingTop: 24, gap: 16, flexGrow: 1 }, emptyMessages: { justifyContent: 'center', paddingBottom: 72 },
  message: { maxWidth: '90%', paddingHorizontal: 14, paddingVertical: 11, borderRadius: 16 }, thinking: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  empty: { alignItems: 'center', alignSelf: 'center', gap: 12, maxWidth: 290 }, emptyIcon: { width: 58, height: 58, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: 4 }, centerText: { textAlign: 'center' }, emptyAction: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 20 }, enable: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 22, borderRadius: 22, marginTop: 8 },
  editorPage: { padding: 16, paddingTop: 24, gap: 16 }, editor: { ...mobileTypography.body, lineHeight: 26, minHeight: 300, textAlignVertical: 'top', padding: 16, borderRadius: 12 },
  history: { borderRadius: 12, overflow: 'hidden' }, historyRow: { minHeight: 68, padding: 16, gap: 5, borderBottomWidth: StyleSheet.hairlineWidth },
})
