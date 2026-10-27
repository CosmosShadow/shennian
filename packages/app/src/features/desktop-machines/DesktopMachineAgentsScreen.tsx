// @arch docs/design/desktop/unified-desktop-control.md
// @arch docs/features/desktop-machine-access-boundary.md
// @test ../../__tests__/desktop-machine-agents.test.ts

import { useCallback, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { getAgentDisplayName } from '@shennian/shared'
import type { AcpExternalSessionInfo, AgentInfo } from '@shennian/wire'
import { useTheme } from '../../hooks/useTheme'
import { AgentPreparationGuide } from '../machines/components/AgentPreparationGuide'
import { desktopMachineAgentsPort } from './desktopMachineAgentsPort'
import { getAgentStatusKind } from '../machines/utils/acp-agent-presentation'
import { DesktopMachineAction } from './DesktopMachineAction'
import { DesktopMachineListState } from './DesktopMachineListState'
import { useDesktopMachineAgentsModel } from './useDesktopMachineAgentsModel'
import { DESKTOP_WORKSPACE_HEADER_HEIGHT } from '../desktop-shell/desktopWorkspaceMetrics'
import { desktopControlMetrics, desktopTypography } from '../desktop-shell/desktopDesignTokens'
import { DesktopDialog } from '../desktop-shell/DesktopDialog'
import { getDesktopControlBridge } from '../desktop-control/bridge'
import { SHENNIAN_AGENT_INSTALL_DOC_URL, SHENNIAN_SKILL_URL } from '../machines/installPrompt'

export default function DesktopMachineAgentsScreen() {
  const { machineId = '' } = useLocalSearchParams<{ machineId: string }>()
  return <DesktopMachineAgents key={machineId} machineId={machineId} />
}

export function DesktopMachineAgents({
  machineId,
  onBack,
}: {
  machineId: string
  onBack?: () => void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const router = useRouter()
  const model = useDesktopMachineAgentsModel(machineId)
  const [guide, setGuide] = useState<{ type: string; name: string } | null>(null)
  const check = useCallback(() => desktopMachineAgentsPort.refresh(machineId), [machineId])
  const loading = !model.sync.bootstrapped
  const syncFailed = model.sync.status?.phase === 'blocked' || Boolean(model.sync.error)
  const offline = model.sync.status?.phase === 'offline'

  if (guide && model.machine)
    return (
      <AgentPreparationGuide
        machine={model.machine}
        agentType={guide.type}
        name={guide.name}
        onBack={() => setGuide(null)}
        onRefresh={check}
      />
    )

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]} testID="desktop-machine-agents">
      <DesktopMachineAgentsHeader
        title={model.machine ? t('machine_agents_current_summary', { name: model.machine.name }) : t('desktop_machine_tools')}
        subtitle={model.machine?.name ?? ''}
        backLabel={t('back')}
        onBack={onBack ?? (() => router.back())}
      />
      <ScrollView contentContainerStyle={styles.content}>
        {loading ? (
          <DesktopMachineListState
            state="initial-loading"
            compact={false}
            onRetry={() => undefined}
          />
        ) : null}
        {!loading && !model.machine && (offline || syncFailed) ? (
          <DesktopMachineListState
            state={offline ? 'offline' : 'error'}
            compact={false}
            onRetry={() => void model.retrySync()}
          />
        ) : null}
        {!loading && !model.machine && !offline && !syncFailed ? (
          <DesktopStateCard
            icon="desktop-outline"
            title={t('machine_not_found')}
            body={t('machine_not_found_body')}
            action={t('go_manage_machines')}
            onAction={onBack ?? (() => router.replace('/(main)/machines'))}
          />
        ) : null}
        {model.machine ? (
          <>
            {offline || syncFailed ? (
              <DesktopMachineListState
                state={offline ? 'offline' : 'error'}
                compact
                onRetry={() => void model.retrySync()}
              />
            ) : null}
            <View
              style={[styles.list, { borderColor: colors.border, backgroundColor: colors.surface }]}
            >
              {model.installedAgents.length ? (
                model.installedAgents.map(({ type, info, isAcp }, index) => {
                  const status = getAgentStatusKind(model.machine!.online, info)
                  const statusLabel = t(
                    status === 'version_mismatch'
                      ? 'machine_agent_version_mismatch_badge'
                      : status === 'installed'
                        ? 'machine_agent_installed'
                        : status === 'auth_required'
                          ? 'machine_agent_auth_required'
                          : status === 'auth_error'
                            ? 'ai_setup_state_configuration'
                            : !isAcp
                              ? 'ai_setup_state_authenticated'
                              : 'machine_agent_available',
                  )
                  const canAuthenticate = Boolean(
                    info?.authState === 'required' && model.machine?.online && model.owner,
                  )
                  return (
                    <AgentRow
                      key={type}
                      info={info}
                      type={type}
                      status={statusLabel}
                      warning={status === 'version_mismatch'}
                      divided={index > 0}
                      busy={model.pending === type || model.pending === `list:${type}`}
                      disabled={Boolean(model.pending)}
                      onPress={() =>
                        !isAcp
                          ? setGuide({ type, name: getAgentDisplayName(type, info?.display?.name) })
                          : canAuthenticate && info
                            ? void model.authenticate(info)
                            : info
                              ? void model.openAgent(info)
                              : undefined
                      }
                    />
                  )
                })
              ) : (
                <Text style={[styles.empty, { color: colors.textTertiary }]}>
                  {t('machine_agent_none_installed')}
                </Text>
              )}
            </View>

            {model.owner ? <DesktopAgentHelpCard /> : null}
            {!model.owner ? (
              <Text style={[styles.hint, { color: colors.textTertiary }]}>
                {t(model.viewOnly ? 'view_only_hint' : 'machine_detail_granted_access_hint')}
              </Text>
            ) : null}
          </>
        ) : null}
      </ScrollView>
      <AgentDetailDialog
        agent={model.selectedAgent}
        suspended={Boolean(model.confirmImport)}
        owner={model.owner}
        machineOnline={Boolean(model.machine?.online)}
        sessions={model.externalSessions}
        loading={Boolean(
          model.selectedAgent && model.pending === `list:${model.selectedAgent.type}`,
        )}
        importingId={
          typeof model.pending === 'string' && model.pending.startsWith('import:')
            ? model.pending.slice(7)
            : ''
        }
        error={model.externalError}
        onClose={model.closeAgent}
        onImport={model.requestImport}
      />
      <ConfirmImportDialog
        session={model.confirmImport}
        busy={typeof model.pending === 'string' && model.pending.startsWith('import:')}
        onCancel={model.cancelImport}
        onConfirm={() => void model.importExternal()}
      />
      <NoticeDialog notice={model.notice} onClose={model.dismissNotice} />
    </View>
  )
}

function DesktopMachineAgentsHeader(props: {
  title: string
  subtitle: string
  backLabel: string
  onBack(): void
}) {
  const { colors } = useTheme()
  return (
    <View style={[styles.header, { borderBottomColor: colors.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={props.backLabel}
        onPress={props.onBack}
        style={({ pressed }) => [
          styles.iconButton,
          pressed && { backgroundColor: colors.surfaceHover },
        ]}
      >
        <Ionicons
          name="arrow-back"
          size={desktopControlMetrics.iconGlyphSize}
          color={colors.text}
        />
      </Pressable>
      <View style={styles.headerCopy}>
        <Text
          accessibilityRole="header"
          numberOfLines={1}
          style={[styles.headerTitle, { color: colors.text }]}
        >
          {props.title}
        </Text>
        {props.subtitle ? (
          <Text numberOfLines={1} style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
            {props.subtitle}
          </Text>
        ) : null}
      </View>
    </View>
  )
}

function DesktopAgentHelpCard() {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const [copied, setCopied] = useState(false)
  const [agentName, setAgentName] = useState('')
  const trimmedAgentName = agentName.trim().replace(/\s+/g, ' ')
  const prompt = trimmedAgentName
    ? t('machine_agents_help_prompt', {
        agent: trimmedAgentName,
        skillUrl: SHENNIAN_SKILL_URL,
        installUrl: SHENNIAN_AGENT_INSTALL_DOC_URL,
      })
    : ''
  const copy = async () => {
    if (!prompt) return
    const ok = await getDesktopControlBridge()?.clipboard?.writeText(prompt)
    if (!ok) return
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }
  return (
    <View style={styles.helpSection}>
      <View style={styles.helpTitleRow}>
        <Text style={[styles.helpTitle, { color: colors.text }]}>
          {t('machine_agents_more_title')}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(copied ? 'copied' : 'machine_agents_copy_help')}
          accessibilityState={{ disabled: !prompt }}
          disabled={!prompt}
          onPress={() => void copy()}
          style={({ pressed }) => [
            styles.copyButton,
            { backgroundColor: pressed ? `${colors.brand}26` : `${colors.brand}14` },
            !prompt && { opacity: 0.45 },
          ]}
        >
          <Ionicons
            name={copied ? 'checkmark' : 'copy-outline'}
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
          setCopied(false)
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
    </View>
  )
}

function SectionTitle({ children }: { children: string }) {
  const { colors } = useTheme()
  return <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>{children}</Text>
}

function AgentRow(props: {
  type: AgentInfo['type']
  info?: AgentInfo
  status: string
  warning: boolean
  divided: boolean
  busy: boolean
  disabled: boolean
  onPress(): void
}) {
  const { colors } = useTheme()
  const [hovered, setHovered] = useState(false)
  return (
    <Pressable
      accessibilityRole={props.disabled ? undefined : 'button'}
      disabled={props.disabled}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      onPress={props.onPress}
      style={[
        styles.row,
        props.divided && {
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: colors.border,
        },
        hovered && !props.disabled && { backgroundColor: colors.surfaceHover },
      ]}
    >
      <View style={styles.rowCopy}>
        <Text numberOfLines={1} style={[styles.rowTitle, { color: colors.text }]}>
          {getAgentDisplayName(props.type, props.info?.display?.name)}
        </Text>
        {props.info?.display?.version ? (
          <Text style={[styles.rowMeta, { color: colors.textTertiary }]}>
            v{props.info.display.version}
          </Text>
        ) : null}
      </View>
      {props.busy ? (
        <ActivityIndicator size="small" color={colors.brand} />
      ) : (
        <>
          <Text
            style={[
              styles.rowStatus,
              { color: props.warning ? colors.warning : colors.textSecondary },
            ]}
          >
            {props.status}
          </Text>
          {!props.disabled ? (
            <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
          ) : null}
        </>
      )}
    </Pressable>
  )
}

function DesktopStateCard(props: {
  icon: keyof typeof Ionicons.glyphMap
  title: string
  body: string
  action: string
  onAction(): void
}) {
  const { colors } = useTheme()
  return (
    <View style={[styles.stateCard, { borderColor: colors.border }]}>
      <Ionicons name={props.icon} size={26} color={colors.textTertiary} />
      <Text style={[styles.stateTitle, { color: colors.text }]}>{props.title}</Text>
      <Text style={[styles.stateBody, { color: colors.textSecondary }]}>{props.body}</Text>
      <DesktopMachineAction compact label={props.action} onPress={props.onAction} />
    </View>
  )
}

function AgentDetailDialog(props: {
  agent: AgentInfo | null
  suspended: boolean
  owner: boolean
  machineOnline: boolean
  sessions: AcpExternalSessionInfo[]
  loading: boolean
  importingId: string
  error: string
  onClose(): void
  onImport(session: AcpExternalSessionInfo): void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const closeRef = useRef<View>(null)
  const capabilities = useMemo(() => capabilityLabels(props.agent, t), [props.agent, t])
  if (!props.agent) return null
  const agent = props.agent
  return (
    <DesktopDialog
      title={getAgentDisplayName(agent.type, agent.display?.name)}
      onClose={props.onClose}
      initialFocusRef={closeRef}
      suspended={props.suspended}
    >
      <View style={styles.dialogContent}>
        <Text style={[desktopTypography.metadata, { color: colors.textSecondary }]}>
          {t('machine_agent_detail_version', { version: agent.display?.version ?? t('unknown') })}
        </Text>
        <SectionTitle>{t('acp_capabilities_title')}</SectionTitle>
        <Text style={{ color: colors.textSecondary }}>
          {capabilities.length
            ? capabilities.join(t('acp_capabilities_separator'))
            : t('acp_capabilities_basic')}
        </Text>
        <SectionTitle>{t('acp_external_sessions_title')}</SectionTitle>
        {!props.owner ? (
          <Text style={{ color: colors.textTertiary }}>
            {t('machine_detail_granted_access_hint')}
          </Text>
        ) : !props.machineOnline ? (
          <Text style={{ color: colors.textTertiary }}>{t('machine_offline')}</Text>
        ) : !agent.acpCapabilities?.listSessions ? (
          <Text style={{ color: colors.textTertiary }}>
            {t('acp_external_sessions_unsupported')}
          </Text>
        ) : props.loading ? (
          <ActivityIndicator color={colors.brand} />
        ) : props.sessions.length ? (
          props.sessions.map((session) => (
            <Pressable
              key={session.agentSessionId}
              accessibilityRole="button"
              disabled={!agent.acpCapabilities?.loadSession || Boolean(props.importingId)}
              onPress={() => props.onImport(session)}
              style={[
                styles.externalRow,
                { borderColor: colors.border, backgroundColor: colors.surface },
              ]}
            >
              <View style={styles.rowCopy}>
                <Text numberOfLines={1} style={[styles.rowTitle, { color: colors.text }]}>
                  {session.title || t('acp_external_session_untitled')}
                </Text>
                <Text numberOfLines={1} style={[styles.rowMeta, { color: colors.textTertiary }]}>
                  {session.cwd}
                </Text>
              </View>
              {props.importingId === session.agentSessionId ? (
                <ActivityIndicator color={colors.brand} />
              ) : (
                <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
              )}
            </Pressable>
          ))
        ) : (
          <Text style={{ color: colors.textTertiary }}>{t('acp_external_sessions_empty')}</Text>
        )}
        {agent.acpCapabilities?.listSessions && !agent.acpCapabilities.loadSession ? (
          <Text style={{ color: colors.textTertiary }}>{t('acp_external_resume_only')}</Text>
        ) : null}
        {props.error ? (
          <Text accessibilityRole="alert" style={{ color: colors.error }}>
            {props.error}
          </Text>
        ) : null}
        <View style={styles.dialogActions}>
          <DesktopMachineAction
            actionRef={closeRef}
            compact
            label={t('close')}
            onPress={props.onClose}
          />
        </View>
      </View>
    </DesktopDialog>
  )
}

function ConfirmImportDialog(props: {
  session: AcpExternalSessionInfo | null
  busy: boolean
  onCancel(): void
  onConfirm(): void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const cancelRef = useRef<View>(null)
  if (!props.session) return null
  return (
    <DesktopDialog
      title={t('acp_external_takeover_title')}
      onClose={props.onCancel}
      busy={props.busy}
      initialFocusRef={cancelRef}
    >
      <View style={styles.dialogContent}>
        <Text style={{ color: colors.textSecondary }}>{t('acp_external_takeover_body')}</Text>
        <View style={styles.dialogActions}>
          <DesktopMachineAction
            actionRef={cancelRef}
            compact
            label={t('cancel')}
            disabled={props.busy}
            onPress={props.onCancel}
          />
          <DesktopMachineAction
            compact
            primary
            label={t('acp_external_takeover_action')}
            disabled={props.busy}
            onPress={props.onConfirm}
          />
        </View>
      </View>
    </DesktopDialog>
  )
}

function NoticeDialog(props: {
  notice: { title: string; message: string } | null
  onClose(): void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const closeRef = useRef<View>(null)
  const title = props.notice?.title.startsWith('auth')
    ? t(
        props.notice.title === 'auth-failed'
          ? 'machine_agent_auth_failed'
          : 'machine_agent_auth_required',
      )
    : t('machines_load_failed_title')
  const message =
    props.notice?.title === 'auth-unavailable'
      ? t('machine_agent_auth_unavailable')
      : props.notice?.title === 'auth-on-machine'
        ? t('machine_agent_auth_on_machine', { id: props.notice.message })
        : props.notice?.message
  if (!props.notice) return null
  return (
    <DesktopDialog title={title} onClose={props.onClose} initialFocusRef={closeRef}>
      <View style={styles.dialogContent}>
        <Text
          accessibilityRole={
            props.notice?.title === 'auth-failed' || props.notice?.title === 'refresh'
              ? 'alert'
              : undefined
          }
          style={{ color: colors.textSecondary }}
        >
          {message}
        </Text>
        <View style={styles.dialogActions}>
          <DesktopMachineAction
            actionRef={closeRef}
            compact
            label={t('close')}
            onPress={props.onClose}
          />
        </View>
      </View>
    </DesktopDialog>
  )
}

function capabilityLabels(agent: AgentInfo | null, t: (key: string) => string): string[] {
  const capability = agent?.acpCapabilities
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
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    minHeight: DESKTOP_WORKSPACE_HEADER_HEIGHT,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconButton: {
    width: desktopControlMetrics.iconButtonSize,
    height: desktopControlMetrics.iconButtonSize,
    borderRadius: desktopControlMetrics.radiusControl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCopy: { flex: 1, minWidth: 0 },
  headerTitle: desktopTypography.windowTitle,
  headerSubtitle: { fontSize: 12, lineHeight: 17 },
  content: {
    width: '100%',
    maxWidth: 1080,
    alignSelf: 'center',
    paddingHorizontal: 24,
    paddingVertical: 20,
    paddingBottom: 48,
    gap: 12,
  },
  summary: { fontSize: 13, lineHeight: 19 },
  sectionTitle: { marginTop: 8, fontSize: 12, lineHeight: 17, fontWeight: '600' },
  list: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, overflow: 'hidden' },
  row: {
    minHeight: 62,
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  rowCopy: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  rowMeta: { marginTop: 2, fontSize: 11, lineHeight: 16 },
  rowStatus: { fontSize: 12, lineHeight: 17, fontWeight: '500' },
  empty: { minHeight: 84, padding: 20, textAlign: 'center', textAlignVertical: 'center' },
  helpSection: {
    marginTop: 8,
    gap: 12,
  },
  helpTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  helpTitle: { ...desktopTypography.sectionTitle, flex: 1 },
  helpBody: desktopTypography.body,
  inputLabel: desktopTypography.body,
  toolInput: {
    minHeight: 40,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    ...desktopTypography.body,
  },
  copyButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  promptCard: { borderWidth: 1, borderRadius: 14, padding: 16 },
  promptText: { ...desktopTypography.body, lineHeight: 24 },
  hint: { fontSize: 12, lineHeight: 18 },
  stateCard: {
    minHeight: 220,
    borderWidth: 1,
    borderRadius: 12,
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  stateTitle: { fontSize: 17, lineHeight: 24, fontWeight: '600' },
  stateBody: { maxWidth: 520, fontSize: 13, lineHeight: 20, textAlign: 'center' },
  dialogContent: { gap: 10 },
  externalRow: {
    minHeight: 52,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  dialogActions: {
    marginTop: 8,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    flexWrap: 'wrap-reverse',
    gap: 8,
  },
})
