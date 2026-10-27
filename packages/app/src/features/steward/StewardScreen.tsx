import { stewardPlaceholderKey, type StewardPageContext } from './contextualSteward'
import { useAuthStore } from '../../config/auth'
// @arch docs/tasks/20260929-1455_神念管家本机入口.md
// @test src/__tests__/steward-navigation.test.ts

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useIsFocused } from '@react-navigation/native'
import { useTranslation } from 'react-i18next'
import type { NianSession } from '@shennian/wire'
import { StewardStandbyComposer } from './components/StewardStandbyComposer'
import type { ComposerFiles } from './standbyFiles'
import { KeyboardAvoidingView } from 'react-native'
import { Platform } from 'react-native'
import { HeaderIconButton } from '../../components/AppPageHeader'
import { useTheme } from '../../hooks/useTheme'
import { mobileTypography } from '../../theme/mobileTypography'
import ChatScreen from '../chat/screens/ChatScreen'
import Ionicons from '@expo/vector-icons/Ionicons'
import { machineNeedsBuiltinUpgrade, machineSupportsSteward, stewardTitle } from './stewardModel'
import { useStewardPrelude } from './useStewardPrelude'
import { useStewardDisplayFloor } from './stewardDisplay'
import { useStewardConversation } from './useStewardConversation'
import { useStewardSessionsStore } from './stewardSessionsStore'
import { personalSessionBodyStore } from '../../storage/db'
import { syncVisiblePersonalSessionBody } from '../chat/services/personalBodyReplicaSync'

import { useMobileModuleBack } from '../../components/useMobileModuleBack'

type PendingStewardRead = { accountId: string; machineId: string; session: NianSession }

type StewardScreenProps = { dockOnly?: boolean; pageContext?: StewardPageContext; moduleContent?: ReactNode; moduleHeader?: ReactNode; composerDraft?: { id: number; text: string } }
export function StewardScreen(props: StewardScreenProps = {}) {
  const accountId = useAuthStore(state => state.user?.id ?? '')
  const { top } = useSafeAreaInsets()
  const { colors } = useTheme()
  // Own the top inset across loading/ready branches. Native SafeAreaView
  // remounts otherwise briefly expose an uninset header during Tab replacement.
  return <View testID="steward-viewport" style={{ flex: props.dockOnly ? undefined : 1, paddingTop: props.dockOnly ? 0 : top, backgroundColor: colors.bg }}>
    <StewardAccountScreen key={accountId} {...props} />
  </View>
}
function StewardAccountScreen({ moduleContent, moduleHeader, composerDraft, dockOnly, pageContext }: StewardScreenProps) {
  const { top } = useSafeAreaInsets()
  const [moduleInput, setModuleInput] = useState('')
  const [standbyBusy, setStandbyBusy] = useState(false)
  const [moduleFiles, setModuleFiles] = useState<ComposerFiles | undefined>()
  const fallbackDraft = useRef<typeof composerDraft>(undefined)
  const router = useRouter()
  const { t } = useTranslation()
  const { colors } = useTheme()
  const steward = useStewardConversation()
  const displayFloor = useStewardDisplayFloor(steward.accountId, steward.machine?.id)
  const placeholder = t(stewardPlaceholderKey(pageContext))
  const inspirationEnabled = !dockOnly && moduleContent === undefined && !pageContext
  useEffect(() => {
    if (steward.status === 'ready' && !standbyBusy) setModuleInput('')
    else if (composerDraft && fallbackDraft.current !== composerDraft) {
      fallbackDraft.current = composerDraft
      setModuleInput(previous => previous.trim() ? `${previous}\n${composerDraft.text}` : composerDraft.text)
    }
  }, [composerDraft, steward.status, standbyBusy])
  const moduleBack = useMobileModuleBack()
  const focused = useIsFocused()
  const focusedRef = useRef(focused)
  focusedRef.current = focused
  const pendingReadRef = useRef<PendingStewardRead | null>(null)
  const readInFlightRef = useRef(false)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const attemptPresentedRead = useCallback(async () => {
    const pending = pendingReadRef.current
    if (!pending || readInFlightRef.current || !focusedRef.current || AppState.currentState !== 'active') return
    readInFlightRef.current = true
    let completed = false
    try {
      // A painted local window may still be behind the Server's index. Retry
      // after the body replica catches up instead of permanently dropping the ack.
      let body = await personalSessionBodyStore.getState(pending.accountId, pending.session.id)
      if ((body?.cachedBodyRevision ?? 0) < (pending.session.bodyRevision ?? 0)) {
        await syncVisiblePersonalSessionBody(pending.session.id)
        body = await personalSessionBodyStore.getState(pending.accountId, pending.session.id)
      }
      if ((body?.cachedBodyRevision ?? 0) >= (pending.session.bodyRevision ?? 0)
        && focusedRef.current && AppState.currentState === 'active') {
        await useStewardSessionsStore.getState().markMachineRead(pending.machineId, pending.session)
        completed = true
      }
    } catch {
      // A transient sync/PATCH failure must not leave a permanent unread dot.
    } finally {
      readInFlightRef.current = false
      if (completed && pendingReadRef.current === pending) pendingReadRef.current = null
      if (pendingReadRef.current && focusedRef.current && !retryTimerRef.current) {
        retryTimerRef.current = setTimeout(() => {
          retryTimerRef.current = null
          void attemptPresentedRead()
        }, 5000)
      }
    }
  }, [])

  useEffect(() => {
    if (focused) {
      if (pendingReadRef.current) void attemptPresentedRead()
      return
    }
    pendingReadRef.current = null
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
    retryTimerRef.current = null
  }, [attemptPresentedRead, focused])

  useEffect(() => () => {
    pendingReadRef.current = null
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
  }, [])

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && pendingReadRef.current) void attemptPresentedRead()
    })
    return () => subscription.remove()
  }, [attemptPresentedRead])

  const markPresentedMachineRead = useCallback(() => {
    const machineId = steward.machine?.id
    const session = steward.session
    const accountId = steward.accountId
    if (!machineId || !session || !accountId) return
    pendingReadRef.current = { accountId, machineId, session }
    void attemptPresentedRead()
  }, [attemptPresentedRead, steward.accountId, steward.machine?.id, steward.session])

  const machine = steward.machine
  const title = stewardTitle(t('steward_title'), steward.showMachineName ? machine?.name : undefined)
  const { prelude, switches } = useStewardPrelude({
    sessions: steward.sessions,
    machineId: dockOnly ? null : machine?.id,
    currentId: steward.sessionId,
    marks: steward.marks,
  })
  const needsBuiltinUpgrade = machineNeedsBuiltinUpgrade(machine)
  const banner = steward.status === 'no_tool' && machine
    ? t(needsBuiltinUpgrade ? 'personal_model_computer_update' : 'personal_model_computer_connect', { name: machine.name })
    : steward.status !== 'ready' ? null
    : machine?.online === false ? t('steward_machine_offline')
      : !machineSupportsSteward(machine) ? t('steward_client_upgrade')
        : null
  // A machine that needs an upgrade or is offline is fixed on its own page, one tap away.
  const openMachine = () => {
    if (machine) router.navigate({ pathname: '/(main)/machine/[machineId]', params: { machineId: machine.id } })
  }
  const header = (
    <View>
      <View
        testID="steward-header"
        style={[styles.header, { backgroundColor: colors.bg, borderBottomColor: colors.separator ?? colors.border }]}
      >
        <View style={styles.moreWrap}>
          <HeaderIconButton testID="steward-back" icon="chevron-back" label={t('back')} onPress={() => moduleBack?.()} />
        </View>
        <Text testID="steward-title" style={[styles.title, { color: colors.text }]} numberOfLines={1}>{title}</Text>
        <HeaderIconButton icon="ellipsis-horizontal" label={t('more')} testID="steward-more" onPress={() => router.push('/(main)/steward-settings')} />
      </View>
      {banner ? (
        <Pressable testID="steward-banner" accessibilityRole="button" onPress={openMachine}
          style={({ pressed }) => [styles.machineBanner, { backgroundColor: pressed ? colors.surfaceHover : colors.bg, borderBottomColor: colors.border }]}>
          <Ionicons name="laptop-outline" size={20} color={colors.textSecondary} />
          <Text style={[styles.machineBannerText, { color: colors.textSecondary }]}>{banner}</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </Pressable>
      ) : null}
    </View>
  )

  if (steward.status === 'ready' && steward.sessionId && !standbyBusy) {
    return (
      <ChatScreen
        key={steward.sessionId}
        sessionIdOverride={steward.sessionId}
        stewardMode
        composerOnly={dockOnly} messageContext={pageContext} stewardInspirationEnabled={inspirationEnabled}
        stewardHeader={moduleHeader ?? header}
        stewardContent={moduleContent}
        composerDraft={composerDraft}
        initialComposerText={moduleInput}
        composerFiles={moduleFiles} onComposerFilesAccepted={() => setModuleFiles(undefined)}
        stewardPlaceholder={placeholder}
        stewardDisplayFloor={displayFloor}
        stewardIntro={t('steward_empty')}
        stewardSession={steward.session}
        stewardPrelude={prelude}
        stewardSwitches={switches}
        stewardShowModel={steward.showModel}
        stewardShowEffort={steward.showEffort}
        stewardConversationView
        stewardName={t('steward_title')}
        onStewardMessagesPresented={markPresentedMachineRead}
      />
    )
  }

  const message = steward.primaryError ? t(steward.primaryError) : steward.status === 'no_machine' ? t('steward_no_machine')
    : steward.status === 'no_tool' ? t(moduleContent ? 'personal_schedule_agent_unavailable' : needsBuiltinUpgrade ? 'personal_model_client_upgrade' : 'personal_model_client_unavailable')
      : null
  return (
    <View style={[!dockOnly && styles.root, { backgroundColor: colors.bg }]}>
      <KeyboardAvoidingView enabled={!dockOnly} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={dockOnly ? undefined : styles.root}
        keyboardVerticalOffset={dockOnly ? 0 : top}>
      {!dockOnly && (moduleHeader ?? header)}
      {!dockOnly && <View style={styles.root}>
      {moduleContent}
      <View style={moduleContent ? styles.banner : styles.center} testID="steward-state">
        {steward.status === 'loading' || steward.status === 'starting' ? (
          // Local cache hydration and background routing checks are not a user task.
          // Leave the conversation surface quiet until the cached chat mounts.
          null
        ) : steward.status === 'failed' ? (
          <>
            <Text style={[styles.stateText, { color: colors.textSecondary }]}>{t('steward_start_failed')}</Text>
            <Pressable testID="steward-retry" accessibilityRole="button" onPress={() => void steward.retry()}
              style={[styles.retry, { borderColor: colors.border }]}>
              <Text style={{ color: colors.text }}>{t('retry')}</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={[styles.stateText, { color: colors.textSecondary }]}>{message}</Text>
            {steward.primaryError ? <Pressable accessibilityRole="button" onPress={() => router.navigate('/(main)/primary-computer')}>
              <Text style={{ color: colors.brand }}>{t('personal_primary_settings')}</Text>
            </Pressable> : null}
          </>
        )}
      </View>
      </View>}
      <StewardStandbyComposer inspirationEnabled={inspirationEnabled} placeholder={placeholder} onBusyChange={setStandbyBusy} input={moduleInput} onChange={setModuleInput} files={moduleFiles} onFiles={setModuleFiles}
        reason={message || t(steward.status === 'failed' ? 'steward_start_failed' : 'steward_loading')} />
      </KeyboardAvoidingView>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { height: 48, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  title: { flex: 1, minWidth: 0, textAlign: 'center', ...mobileTypography.navigationTitle },
  moreWrap: { position: 'relative' },
  headerSpacer: { width: 44 },
  moreUnreadDot: { position: 'absolute', top: 6, right: 6, width: 8, height: 8, borderRadius: 4 },
  banner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 16, paddingVertical: 10 },
  machineBanner: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  machineBannerText: { ...mobileTypography.body, flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 32 },
  stateText: { ...mobileTypography.body, textAlign: 'center' },
  retry: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10 },
})
