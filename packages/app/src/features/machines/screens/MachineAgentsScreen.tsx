// @arch docs/features/acp-agent-support.md#8-agent-列表体验
// @arch docs/features/desktop-machine-access-boundary.md
// @test src/__tests__/machine-detail-source.test.ts
// @test src/__tests__/machine-agent-install.test.ts

import { useCallback, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import * as Clipboard from 'expo-clipboard'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import { getAgentDisplayName, useMachinesStore, useSessionsStore } from '@shennian/shared'
import type { AcpExternalSessionInfo, AgentInfo, AgentType } from '@shennian/wire'
import { AgentPreparationGuide } from '../components/AgentPreparationGuide'
import { AppPageHeader } from '../../../components/AppPageHeader'
import { accountRuntime } from '../../account-runtime/accountRuntime'
import { useGoBack } from '../../../hooks/useGoBack'
import { useTheme } from '../../../hooks/useTheme'
import { mobileTypography } from '../../../theme/mobileTypography'
import { getAgentStatusKind, groupInstalledAgents } from '../utils/acp-agent-presentation'
import { isMachineOwner } from '../utils/machineAccessPolicy'
import { machineAccountClient } from '../machineAccountClient'
import { copySetupText } from '../utils/setupClipboard'
import { SHENNIAN_AGENT_INSTALL_DOC_URL, SHENNIAN_SKILL_URL } from '../installPrompt'

export default function MachineAgentsScreen() {
  const { machineId } = useLocalSearchParams<{ machineId: string }>()
  const { t } = useTranslation()
  const router = useRouter()
  const goBack = useGoBack()
  const { colors } = useTheme()
  const machines = useMachinesStore((store) => store.machines)
  const setMachines = useMachinesStore((store) => store.setMachines)
  const upsertSession = useSessionsStore((store) => store.upsertSession)
  const [guide, setGuide] = useState<{ type: string; name: string } | null>(null)
  const [agentAuthPending, setAgentAuthPending] = useState<AgentType | null>(null)
  const [selectedAcpAgent, setSelectedAcpAgent] = useState<AgentInfo | null>(null)
  const [externalSessions, setExternalSessions] = useState<AcpExternalSessionInfo[]>([])
  const [externalSessionsLoading, setExternalSessionsLoading] = useState(false)
  const [externalSessionError, setExternalSessionError] = useState('')
  const [importingExternalSession, setImportingExternalSession] = useState('')

  const machine = machines.find((item) => item.id === machineId)
  const isOwner = isMachineOwner(machine)
  const isViewOnly = machine?.role === 'granted' && machine.permission === 'view'
  const installedAgents = useMemo(() => {
    const grouped = groupInstalledAgents(machine)
    return grouped.all
      .map((row, sourceIndex) => ({
        ...row,
        isAcp: row.info?.integration === 'acp' || row.type.startsWith('acp:'),
        sourceIndex,
      }))
      .sort((left, right) => {
        const priority = (info?: AgentInfo) => {
          const status = getAgentStatusKind(Boolean(machine?.online), info)
          return status === 'auth_required' ? 0 : status === 'version_mismatch' ? 1 : 2
        }
        return priority(left.info) - priority(right.info) || left.sourceIndex - right.sourceIndex
      })
  }, [machine])
  const selectedAcpCapabilities = useMemo(() => {
    const capability = selectedAcpAgent?.acpCapabilities
    if (!capability) return []
    return [
      capability.listSessions && t('acp_capability_history'),
      capability.loadSession && t('acp_capability_import'),
      capability.resumeSession && t('acp_capability_resume'),
      capability.modelConfig && t('acp_capability_model_config'),
      capability.permission && t('acp_capability_permission'),
      capability.fileRead && t('acp_capability_file_read'),
      capability.fileWrite && t('acp_capability_file_write'),
      capability.terminal && t('acp_capability_terminal'),
    ].filter((label): label is string => Boolean(label))
  }, [selectedAcpAgent?.acpCapabilities, t])

  const checkAgents = useCallback(async () => {
    if (!machine?.id || !machine.online || !isOwner) return
    const response = await accountRuntime.requestMachine(
      machine.id,
      'agents.refresh',
      {},
      { connectTimeoutMs: 15_000, responseTimeoutMs: 120_000 },
    )
    if (!response.ok) throw new Error('Agent discovery failed')
    setMachines(await machineAccountClient.listMachines())
  }, [isOwner, machine?.id, machine?.online, setMachines])

  const handleAgentAuth = useCallback(
    async (agentType: AgentType) => {
      if (!machine?.online || !isOwner || agentAuthPending) return
      const info = machine.agents?.find((item) => item.type === agentType)
      const method = info?.acpAuthMethods?.[0]
      if (!method) {
        Alert.alert(t('machine_agent_auth_required'), t('machine_agent_auth_unavailable'))
        return
      }
      if (method.type === 'terminal') {
        Alert.alert(
          t('machine_agent_auth_required'),
          t('machine_agent_auth_on_machine', { id: agentType.replace(/^acp:/, '') }),
        )
        return
      }
      setAgentAuthPending(agentType)
      try {
        const response = await accountRuntime.requestMachine(
          machine.id,
          'agent.auth.start',
          { agentType, methodId: method.id },
          { connectTimeoutMs: 15_000, responseTimeoutMs: 150_000 },
        )
        if (!response.ok) throw new Error(response.error ?? t('machine_agent_auth_failed'))
        await checkAgents()
      } catch (error) {
        Alert.alert(
          t('machine_agent_auth_failed'),
          error instanceof Error ? error.message : String(error),
        )
      } finally {
        setAgentAuthPending(null)
      }
    },
    [agentAuthPending, checkAgents, isOwner, machine, t],
  )

  const openAcpAgent = useCallback(
    async (info: AgentInfo) => {
      if (!machine) return
      setSelectedAcpAgent(info)
      setExternalSessions([])
      setExternalSessionError('')
      if (!isOwner || !machine.online || !info.acpCapabilities?.listSessions) return
      setExternalSessionsLoading(true)
      try {
        const response = await accountRuntime.requestMachine(
          machine.id,
          'agent.external-sessions.list',
          { agentType: info.type },
          { connectTimeoutMs: 15_000, responseTimeoutMs: 30_000 },
        )
        if (!response.ok) throw new Error(response.error ?? t('acp_external_sessions_failed'))
        const sessions = (response.payload as { sessions?: AcpExternalSessionInfo[] } | undefined)
          ?.sessions
        setExternalSessions(Array.isArray(sessions) ? sessions : [])
      } catch (error) {
        setExternalSessionError(error instanceof Error ? error.message : String(error))
      } finally {
        setExternalSessionsLoading(false)
      }
    },
    [isOwner, machine, t],
  )

  const importExternalSession = useCallback(
    async (external: AcpExternalSessionInfo) => {
      if (
        !machine ||
        !isOwner ||
        !selectedAcpAgent?.acpCapabilities?.loadSession ||
        importingExternalSession
      )
        return
      const confirmed = await new Promise<boolean>((resolve) =>
        Alert.alert(
          t('acp_external_takeover_title'),
          t('acp_external_takeover_body'),
          [
            { text: t('cancel'), style: 'cancel', onPress: () => resolve(false) },
            { text: t('acp_external_takeover_action'), onPress: () => resolve(true) },
          ],
          { cancelable: true, onDismiss: () => resolve(false) },
        ),
      )
      if (!confirmed) return
      setImportingExternalSession(external.agentSessionId)
      setExternalSessionError('')
      let createdSessionId = ''
      try {
        const createdSession = await machineAccountClient.createSession({
          machineId: machine.id,
          agentType: selectedAcpAgent.type,
          workDir: external.cwd,
          sessionMode: 'standard',
        })
        createdSessionId = createdSession.id
        const response = await accountRuntime.requestMachine(
          machine.id,
          'agent.external-sessions.import',
          {
            agentType: selectedAcpAgent.type,
            agentSessionId: external.agentSessionId,
            sessionId: createdSession.id,
            cwd: external.cwd,
            title: external.title,
          },
          { connectTimeoutMs: 15_000, responseTimeoutMs: 120_000 },
        )
        if (!response.ok) throw new Error(response.error ?? t('acp_external_import_failed'))
        const session = {
          ...createdSession,
          agentSessionId: external.agentSessionId,
          title: external.title || createdSession.title,
        }
        await accountRuntime.persistSession(session)
        upsertSession(session)
        setSelectedAcpAgent(null)
        router.navigate(`/(main)/chat/${session.id}`)
      } catch (error) {
        if (createdSessionId) {
          await machineAccountClient.deleteSession(createdSessionId).catch(() => null)
        }
        setExternalSessionError(error instanceof Error ? error.message : String(error))
      } finally {
        setImportingExternalSession('')
      }
    },
    [importingExternalSession, isOwner, machine, router, selectedAcpAgent, t, upsertSession],
  )

  if (!machine) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]} edges={['top']}>
        <AppPageHeader title={t('machine_detail_agents')} onBack={goBack} />
        <View style={styles.center}>
          <Text style={[styles.hintText, { color: colors.textSecondary }]}>
            {t('machine_not_found')}
          </Text>
        </View>
      </SafeAreaView>
    )
  }

  if (guide)
    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: colors.bg }]}
        edges={['top', 'bottom']}
      >
        <AgentPreparationGuide
          machine={machine}
          agentType={guide.type}
          name={guide.name}
          onBack={() => setGuide(null)}
          onRefresh={checkAgents}
        />
      </SafeAreaView>
    )

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]} edges={['top']}>
      <AppPageHeader title={machine ? t('machine_agents_current_summary', { name: machine.name }) : t('machine_detail_agents')} onBack={goBack} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {installedAgents.length ? (
          <View
            style={[
              styles.agentList,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            {installedAgents.map(({ type, info, isAcp }, index) => {
              const statusKind = getAgentStatusKind(machine.online, info)
              const statusLabel =
                statusKind === 'version_mismatch'
                  ? t('machine_agent_version_mismatch_badge')
                  : statusKind === 'installed'
                    ? t('machine_agent_installed')
                    : statusKind === 'auth_required'
                      ? t('machine_agent_auth_required')
                      : statusKind === 'auth_error'
                        ? t('ai_setup_state_configuration')
                        : !isAcp
                          ? t('ai_setup_state_authenticated')
                          : t('machine_agent_available')
              const name = getAgentDisplayName(type, info?.display?.name)
              const canAuthenticate = info?.authState === 'required' && machine.online && isOwner
              const interactive = true
              return (
                <Pressable
                  key={type}
                  style={[
                    styles.agentRow,
                    index < installedAgents.length - 1 && {
                      borderBottomWidth: StyleSheet.hairlineWidth,
                      borderBottomColor: colors.border,
                    },
                  ]}
                  disabled={!interactive || Boolean(agentAuthPending)}
                  onPress={() =>
                    !isAcp
                      ? setGuide({ type, name })
                      : canAuthenticate
                        ? void handleAgentAuth(type)
                        : info
                          ? void openAcpAgent(info)
                          : undefined
                  }
                  accessibilityRole={interactive ? 'button' : undefined}
                  accessibilityLabel={`${name} ${statusLabel}`}
                >
                  <View style={styles.agentIdentity}>
                    <Text style={[styles.agentName, { color: colors.text }]} numberOfLines={1}>
                      {name}
                    </Text>
                    {info?.display?.version ? (
                      <Text
                        style={[
                          styles.agentVersion,
                          {
                            color:
                              Platform.OS === 'web'
                                ? colors.textTertiary
                                : colors.textMutedOnSurface,
                          },
                        ]}
                      >
                        v{info.display.version}
                      </Text>
                    ) : null}
                  </View>
                  <View style={styles.agentRight}>
                    {agentAuthPending === type ? (
                      <ActivityIndicator size="small" color={colors.brand} />
                    ) : (
                      <Text
                        style={[
                          styles.agentStatus,
                          {
                            color:
                              statusKind === 'version_mismatch'
                                ? colors.warning
                                : colors.textSecondary,
                          },
                        ]}
                      >
                        {statusLabel}
                      </Text>
                    )}
                    {interactive ? (
                      <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
                    ) : null}
                  </View>
                </Pressable>
              )
            })}
          </View>
        ) : (
          <View
            style={[styles.empty, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <Text style={[styles.hintText, { color: colors.textTertiary }]}>
              {t('machine_agent_none_installed')}
            </Text>
          </View>
        )}
        {isOwner ? <MachineAgentHelp /> : null}
        {!isOwner ? (
          <Text style={[styles.hintText, { color: colors.textTertiary }]}>
            {isViewOnly ? t('view_only_hint') : t('machine_detail_granted_access_hint')}
          </Text>
        ) : null}
      </ScrollView>
      <Modal
        visible={Boolean(selectedAcpAgent)}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedAcpAgent(null)}
      >
        <View style={styles.overlay}>
          <View
            style={[styles.dialog, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <Text style={[styles.dialogTitle, { color: colors.text }]}>
              {getAgentDisplayName(
                selectedAcpAgent?.type ?? 'acp:agent',
                selectedAcpAgent?.display?.name,
              )}
            </Text>
            <Text style={[styles.dialogBody, { color: colors.textSecondary }]}>
              {t('machine_agent_detail_version', {
                version: selectedAcpAgent?.display?.version ?? t('unknown'),
              })}
            </Text>
            <Text style={[styles.subsectionTitle, { color: colors.text }]}>
              {t('acp_capabilities_title')}
            </Text>
            <Text style={[styles.dialogBody, { color: colors.textSecondary }]}>
              {selectedAcpCapabilities.length
                ? selectedAcpCapabilities.join(t('acp_capabilities_separator'))
                : t('acp_capabilities_basic')}
            </Text>
            {isOwner && selectedAcpAgent?.acpCapabilities?.listSessions ? (
              <>
                <Text style={[styles.subsectionTitle, { color: colors.text }]}>
                  {t('acp_external_sessions_title')}
                </Text>
                {externalSessionsLoading ? <ActivityIndicator color={colors.brand} /> : null}
                {!externalSessionsLoading && !externalSessions.length ? (
                  <Text
                    style={[
                      styles.hintText,
                      {
                        color:
                          Platform.OS === 'web' ? colors.textTertiary : colors.textMutedOnSurface,
                      },
                    ]}
                  >
                    {t('acp_external_sessions_empty')}
                  </Text>
                ) : null}
                {externalSessions.map((external) => (
                  <Pressable
                    key={external.agentSessionId}
                    style={[
                      styles.externalSessionRow,
                      { backgroundColor: colors.bg, borderColor: colors.border },
                    ]}
                    disabled={
                      !selectedAcpAgent.acpCapabilities?.loadSession ||
                      Boolean(importingExternalSession)
                    }
                    onPress={() => void importExternalSession(external)}
                    accessibilityRole="button"
                    accessibilityLabel={`${external.title || t('acp_external_session_untitled')} ${t('acp_external_takeover_action')}`}
                    accessibilityState={{
                      disabled:
                        !selectedAcpAgent.acpCapabilities?.loadSession ||
                        Boolean(importingExternalSession),
                      busy: importingExternalSession === external.agentSessionId,
                    }}
                  >
                    <View style={styles.agentIdentity}>
                      <Text style={[styles.agentName, { color: colors.text }]} numberOfLines={1}>
                        {external.title || t('acp_external_session_untitled')}
                      </Text>
                      <Text
                        style={[styles.agentVersion, { color: colors.textTertiary }]}
                        numberOfLines={1}
                      >
                        {external.cwd}
                      </Text>
                    </View>
                    {importingExternalSession === external.agentSessionId ? (
                      <ActivityIndicator color={colors.brand} />
                    ) : (
                      <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
                    )}
                  </Pressable>
                ))}
                {!selectedAcpAgent.acpCapabilities.loadSession ? (
                  <Text style={[styles.hintText, { color: colors.textTertiary }]}>
                    {t('acp_external_resume_only')}
                  </Text>
                ) : null}
              </>
            ) : !isOwner ? (
              <Text style={[styles.hintText, { color: colors.textTertiary }]}>
                {t('machine_detail_granted_access_hint')}
              </Text>
            ) : (
              <Text style={[styles.hintText, { color: colors.textTertiary }]}>
                {t('acp_external_sessions_unsupported')}
              </Text>
            )}
            {externalSessionError ? (
              <Text accessibilityRole="alert" style={[styles.errorText, { color: colors.error }]}>
                {externalSessionError}
              </Text>
            ) : null}
            <View style={styles.dialogActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('close')}
                style={[styles.dialogBtn, { backgroundColor: colors.bg }]}
                onPress={() => setSelectedAcpAgent(null)}
              >
                <Ionicons name="close" size={24} color={colors.text} />
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

function MachineAgentHelp() {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [agentName, setAgentName] = useState('')
  const inFlight = useRef(false)
  const trimmedAgentName = agentName.trim().replace(/\s+/g, ' ')
  const prompt = trimmedAgentName
    ? t('machine_agents_help_prompt', {
        agent: trimmedAgentName,
        skillUrl: SHENNIAN_SKILL_URL,
        installUrl: SHENNIAN_AGENT_INSTALL_DOC_URL,
      })
    : ''
  const copy = async () => {
    if (inFlight.current || !prompt) return
    inFlight.current = true
    const result = await copySetupText(prompt, Clipboard.setStringAsync)
    setStatus(result)
    inFlight.current = false
    if (result === 'copied') setTimeout(() => setStatus('idle'), 1500)
  }

  return (
    <View style={styles.helpSection}>
      <View style={styles.helpTitleRow}>
        <Text style={[styles.helpTitle, { color: colors.text }]}>
          {t('machine_agents_more_title')}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(status === 'copied' ? 'copied' : 'machine_agents_copy_help')}
          accessibilityState={{ disabled: !prompt }}
          disabled={!prompt}
          hitSlop={8}
          onPress={() => void copy()}
          style={({ pressed }) => [
            styles.copyButton,
            { backgroundColor: pressed ? `${colors.brand}26` : `${colors.brand}14` },
            !prompt && { opacity: 0.45 },
          ]}
        >
          <Ionicons
            name={status === 'copied' ? 'checkmark' : 'copy-outline'}
            size={18}
            color={colors.brand}
          />
        </Pressable>
      </View>
      <Text style={[styles.helpBody, { color: colors.text }]}>
        {t('machine_agents_missing_hint')}
      </Text>
      <Text style={[styles.inputLabel, { color: colors.text }]}>
        {t('machine_agents_tool_label')}
      </Text>
      <TextInput
        accessibilityLabel={t('machine_agents_tool_label')}
        value={agentName}
        onChangeText={(value) => {
          setAgentName(value)
          setStatus('idle')
        }}
        placeholder={t('machine_agents_tool_placeholder')}
        placeholderTextColor={colors.textTertiary}
        maxLength={120}
        autoCapitalize="words"
        returnKeyType="done"
        style={[
          styles.toolInput,
          { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface },
        ]}
      />
      {prompt ? (
        <View
          style={[
            styles.promptCard,
            { borderColor: `${colors.brand}55`, backgroundColor: colors.brandLight },
          ]}
        >
          <Text selectable style={[styles.promptText, { color: colors.text }]}>
            {prompt}
          </Text>
        </View>
      ) : null}
      {status === 'failed' ? (
        <Text accessibilityRole="alert" style={{ color: colors.errorText }}>
          {t('setup_copy_failed')}
        </Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 40, gap: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  summary: {
    fontSize: 13,
    lineHeight: 19,
    ...(Platform.OS !== 'web' && mobileTypography.metadata),
  },
  agentList: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, overflow: 'hidden' },
  agentRow: {
    minHeight: 64,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  agentIdentity: { flex: 1, minWidth: 0 },
  agentName: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    flexShrink: 1,
    ...(Platform.OS !== 'web' && mobileTypography.listTitle),
  },
  helpSection: {
    marginTop: 12,
    gap: 12,
  },
  helpTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  helpTitle: { ...mobileTypography.sectionTitle, flex: 1 },
  helpBody: mobileTypography.secondary,
  inputLabel: mobileTypography.secondary,
  toolInput: {
    minHeight: Platform.OS === 'android' ? 48 : 44,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    ...mobileTypography.body,
  },
  copyButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  promptCard: { borderWidth: 1, borderRadius: 14, padding: 16 },
  promptText: mobileTypography.secondary,
  agentVersion: {
    fontSize: 11,
    lineHeight: 15,
    marginTop: 2,
    ...(Platform.OS !== 'web' && mobileTypography.metadata),
  },
  agentRight: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 0 },
  agentStatus: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    ...(Platform.OS !== 'web' && mobileTypography.secondary),
  },
  empty: {
    minHeight: 84,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  hintText: {
    fontSize: 12,
    lineHeight: 18,
    ...(Platform.OS !== 'web' && mobileTypography.metadata),
  },
  externalSessionRow: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  subsectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    ...(Platform.OS !== 'web' && mobileTypography.sectionTitle),
  },
  errorText: { fontSize: 12, lineHeight: 18 },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.38)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  dialog: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 18,
    gap: 12,
  },
  dialogTitle: {
    fontSize: 17,
    fontWeight: '700',
    ...(Platform.OS !== 'web' && mobileTypography.navigationTitle),
  },
  dialogBody: {
    fontSize: 14,
    lineHeight: 21,
    ...(Platform.OS !== 'web' && mobileTypography.secondary),
  },
  dialogActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 4,
  },
  dialogBtn: {
    minWidth: 88,
    minHeight: 44,
    borderRadius: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dialogBtnText: {
    fontSize: 14,
    fontWeight: '600',
    ...(Platform.OS !== 'web' && mobileTypography.body),
  },
})
