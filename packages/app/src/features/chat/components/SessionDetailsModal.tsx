import { ConversationSchedules } from '../../schedules/ConversationSchedules'
import { canShowSessionSchedules } from '../../schedules/scheduleVisibility'
// @arch docs/architecture/app/modular-features.md#聊天-feature
// @test src/__tests__/session-details-modal.test.ts

import { useContext, useEffect, useRef, useState } from 'react'
import {
  RoomAgentModeContext,
  RoomAgentModePicker,
} from '../../rooms/components/RoomAgentModePicker'
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import Feather from '@expo/vector-icons/Feather'
import { useTranslation } from 'react-i18next'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  managedAgentExecutionMode,
  type ManagedAgentPermissionPolicy,
  type SessionMode,
} from '@shennian/wire'
import type { Colors } from '../../../hooks/useTheme'
import { mobileTypography } from '../../../theme/mobileTypography'
import { useEscapeKey } from '../../../hooks/useEscapeKey'
import { useWebModalFocus } from '../../../hooks/useWebModalFocus'
import type { PublicAvatar } from '../../rooms/types'
import type { LinkedRoomBindingView } from '../../rooms/types'
import { RoomIdentityAvatar } from '../../rooms/components/RoomIdentityAvatar'
import {
  MANAGED_AGENT_EXTERNAL_CAPABILITIES,
  managedAgentCapabilityKey,
  managedAgentFileAccessKey,
} from '../../agents/ManagedAgentPermissionSettings'

type Props = {
  sessionId?: string
  visible: boolean
  onClose: () => void
  agentLabel: string
  currentModelLabel: string
  machineName: string
  workDir: string
  agentIdentityId?: string | null
  roomBinding?: LinkedRoomBindingView | null
  agentName?: string
  agentDescription?: string
  agentAvatar?: PublicAvatar | null
  agentOwnerAvatar?: PublicAvatar | null
  agentOwnerName?: string | null
  permissionPolicy?: ManagedAgentPermissionPolicy
  sessionMode?: SessionMode
  runtimeLoading?: boolean
  runtimeLoadFailed?: boolean
  colors: Colors
  canManage: boolean
  onOpenFileBrowser: () => void
  onRename: () => void
  onDelete: () => void
  onOpenAgentSettings?: () => void
  onRestart?: () => void
  restartBusy?: boolean
  desktopInspector?: boolean
}

export function SessionDetailsModal({
  sessionId,
  visible,
  onClose,
  agentLabel,
  currentModelLabel,
  machineName,
  workDir,
  agentIdentityId,
  roomBinding = null,
  agentName,
  agentDescription,
  agentAvatar,
  agentOwnerAvatar,
  agentOwnerName,
  permissionPolicy,
  sessionMode = 'standard',
  runtimeLoading = false,
  runtimeLoadFailed = false,
  colors,
  canManage,
  onOpenFileBrowser,
  onRename,
  onDelete,
  onOpenAgentSettings,
  onRestart,
  restartBusy = false,
  desktopInspector = false,
}: Props) {
  const { t } = useTranslation()
  const roomModeTarget = useContext(RoomAgentModeContext)
  const [choosingRoomMode, setChoosingRoomMode] = useState(false)
  const inspectorRef = useRef<View>(null)
  const closeButtonRef = useRef<View>(null)
  const { height: windowHeight } = useWindowDimensions()
  const showDesktopInspector = desktopInspector && Platform.OS === 'web'
  useEffect(() => {
    if (!visible) setChoosingRoomMode(false)
  }, [visible])
  const insets = useSafeAreaInsets()
  useEscapeKey(visible, onClose)
  useWebModalFocus({
    visible: showDesktopInspector && visible,
    containerRef: inspectorRef,
    initialFocusRef: closeButtonRef,
  })
  const summaryMeta = [currentModelLabel, machineName].filter(Boolean).join(' · ')
  const managedAgent = Boolean(agentIdentityId)
  const nativeFull = permissionPolicy
    ? managedAgentExecutionMode(permissionPolicy) === 'native-full'
    : false
  const fileAccessLabel = permissionPolicy
    ? t(managedAgentFileAccessKey(permissionPolicy.fileAccess))
    : '—'
  const enabledCapabilityLabels = permissionPolicy
    ? MANAGED_AGENT_EXTERNAL_CAPABILITIES.filter(
        (capability) => permissionPolicy.externalCapabilities[capability],
      ).map((capability) => t(managedAgentCapabilityKey(capability)))
    : []
  const externalCapabilitiesLabel = permissionPolicy
    ? formatExternalCapabilities(enabledCapabilityLabels, t)
    : '—'
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        accessible={false}
        style={[
          styles.overlay,
          showDesktopInspector && styles.inspectorOverlay,
          { paddingBottom: showDesktopInspector ? 16 : Math.max(insets.bottom, 10) },
        ]}
        onPress={onClose}
      >
        <View
          ref={showDesktopInspector ? inspectorRef : undefined}
          accessible={showDesktopInspector || false}
          accessibilityViewIsModal
          style={[
            styles.sheet,
            showDesktopInspector && styles.inspector,
            showDesktopInspector && { maxHeight: Math.max(320, windowHeight - 80) },
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
          onStartShouldSetResponder={() => true}
        >
          {!showDesktopInspector ? <View style={styles.handle} /> : null}
          <View style={[styles.header, showDesktopInspector && styles.inspectorHeader]}>
            <Text
              style={[
                styles.title,
                showDesktopInspector && styles.inspectorTitle,
                { color: colors.text },
              ]}
            >
              {choosingRoomMode
                ? t('spaces_agent_work_mode')
                : t(
                    managedAgent
                      ? 'session_details_managed_agent'
                      : 'session_details_accessibility',
                  )}
            </Text>
            <Pressable
              ref={showDesktopInspector ? closeButtonRef : undefined}
              accessibilityRole="button"
              accessibilityLabel={t('close')}
              hitSlop={8}
              style={[styles.closeButton, { backgroundColor: colors.surfaceHover }]}
              onPress={onClose}
            >
              <Text style={[styles.closeText, { color: colors.textSecondary }]}>✕</Text>
            </Pressable>
          </View>

          <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled">
            {choosingRoomMode && roomModeTarget && canManage ? (
              <RoomAgentModePicker
                inline
                target={roomModeTarget}
                onClose={() => setChoosingRoomMode(false)}
              />
            ) : (
              <>
                <Pressable
                  disabled={!managedAgent || !onOpenAgentSettings}
                  style={[
                    styles.summaryCard,
                    showDesktopInspector && styles.inspectorCard,
                    { backgroundColor: colors.surfaceHover },
                  ]}
                  onPress={onOpenAgentSettings}
                >
                  {managedAgent ? (
                    <RoomIdentityAvatar
                      name={agentName || agentLabel}
                      avatar={agentAvatar}
                      agent
                      ownerAvatar={agentOwnerAvatar}
                      ownerName={agentOwnerName}
                      size={42}
                    />
                  ) : (
                    <View style={[styles.summaryIcon, { backgroundColor: colors.bg }]}>
                      <Ionicons name="sparkles-outline" size={20} color={colors.brand} />
                    </View>
                  )}
                  <View style={styles.summaryText}>
                    <Text numberOfLines={1} style={[styles.summaryTitle, { color: colors.text }]}>
                      {agentName || agentLabel || t('session_details_accessibility')}
                    </Text>
                    {managedAgent && agentDescription ? (
                      <Text
                        numberOfLines={1}
                        style={[styles.summaryMeta, { color: colors.textSecondary }]}
                      >
                        {agentDescription}
                      </Text>
                    ) : summaryMeta ? (
                      <Text
                        numberOfLines={1}
                        style={[styles.summaryMeta, { color: colors.textSecondary }]}
                      >
                        {summaryMeta}
                      </Text>
                    ) : null}
                    {!managedAgent && workDir ? (
                      <Text
                        numberOfLines={1}
                        ellipsizeMode="middle"
                        style={[
                          styles.summaryPath,
                          { color: Platform.OS === 'web' ? colors.textTertiary : colors.textMuted },
                        ]}
                      >
                        {workDir}
                      </Text>
                    ) : null}
                  </View>
                  {managedAgent && onOpenAgentSettings ? (
                    <Feather name="chevron-right" size={18} color={colors.textTertiary} />
                  ) : null}
                </Pressable>

                {managedAgent ? (
                  <>
                    <Text style={[styles.sectionLabel, { color: colors.textTertiary }]}>
                      {t('session_runtime_section')}
                    </Text>
                    <View
                      style={[
                        styles.runtimeCard,
                        showDesktopInspector && styles.inspectorCard,
                        { backgroundColor: colors.surfaceHover },
                      ]}
                    >
                      {runtimeLoading ? (
                        <View style={styles.runtimeState}>
                          <ActivityIndicator size="small" color={colors.brand} />
                          <Text style={[styles.runtimeStateText, { color: colors.textSecondary }]}>
                            {t('session_runtime_loading')}
                          </Text>
                        </View>
                      ) : runtimeLoadFailed ? (
                        <View style={styles.runtimeState}>
                          <Text style={[styles.runtimeStateText, { color: colors.textSecondary }]}>
                            {t('session_runtime_load_failed')}
                          </Text>
                        </View>
                      ) : (
                        <>
                          <SessionRuntimeRow
                            label={t('agents_machine')}
                            value={machineName}
                            colors={colors}
                          />
                          <SessionRuntimeRow
                            label={t('agents_work_directory')}
                            value={workDir}
                            colors={colors}
                            divided
                            middle
                          />
                          <SessionRuntimeRow
                            label={t('agents_runtime')}
                            value={agentLabel}
                            colors={colors}
                            divided
                          />
                          <SessionRuntimeRow
                            label={t('agents_model')}
                            value={currentModelLabel}
                            colors={colors}
                            divided
                          />
                          <SessionRuntimeRow
                            label={t('session_work_mode')}
                            value={t(
                              sessionMode === 'manager'
                                ? 'session_mode_manager'
                                : 'session_mode_standard',
                            )}
                            colors={colors}
                            divided
                          />
                          {nativeFull ? (
                            <SessionRuntimeRow
                              label={t('agents_run_access')}
                              value={t('agents_run_access_full')}
                              colors={colors}
                              divided
                            />
                          ) : (
                            <>
                              <SessionRuntimeRow
                                label={t('agents_file_access')}
                                value={fileAccessLabel}
                                colors={colors}
                                divided
                              />
                              <SessionRuntimeRow
                                label={t('agents_external_capabilities')}
                                value={externalCapabilitiesLabel}
                                colors={colors}
                                divided
                              />
                            </>
                          )}
                        </>
                      )}
                    </View>
                  </>
                ) : null}

                {!managedAgent ? (
                  <>
                    <View style={[styles.actionGroup, { backgroundColor: colors.surfaceHover }]}>
                      <SessionDetailAction
                        icon="folder"
                        label={t('file_browser')}
                        colors={colors}
                        onPress={onOpenFileBrowser}
                      />
                      {canManage ? (
                        <SessionDetailAction
                          icon="edit-2"
                          label={t('rename_session')}
                          colors={colors}
                          onPress={onRename}
                          divided
                        />
                      ) : null}
                    </View>
                  </>
                ) : null}

                {canManage && managedAgent && roomModeTarget ? (
                  <View style={[styles.actionGroup, { backgroundColor: colors.surfaceHover }]}>
                    <SessionDetailAction
                      icon="sliders"
                      colors={colors}
                      label={`${t('spaces_agent_work_mode')}${
                        roomModeTarget.activationMode
                          ? `：${t(`spaces_agent_mode_${roomModeTarget.activationMode}`)}`
                          : ''
                      }`}
                      onPress={() => setChoosingRoomMode(true)}
                    />
                  </View>
                ) : null}
                {canManage && managedAgent && onRestart ? (
                  <View
                    style={[
                      styles.actionGroup,
                      styles.restartGroup,
                      { backgroundColor: colors.surfaceHover },
                    ]}
                  >
                    <SessionDetailAction
                      icon="rotate-ccw"
                      label={restartBusy ? t('session_restart_busy') : t('session_restart')}
                      colors={colors}
                      onPress={onRestart}
                      disabled={restartBusy}
                    />
                  </View>
                ) : null}

                {canManage && !managedAgent ? (
                  <View style={[styles.dangerGroup, { backgroundColor: colors.surfaceHover }]}>
                    <SessionDetailAction
                      icon="trash-2"
                      label={t('delete_session')}
                      colors={colors}
                      onPress={onDelete}
                      danger
                    />
                  </View>
                ) : null}
                {sessionId && canShowSessionSchedules(canManage, agentIdentityId, roomBinding)
                  ? <ConversationSchedules sessionId={sessionId} />
                  : null}
              </>
            )}
          </ScrollView>
        </View>
      </Pressable>
    </Modal>
  )
}

function formatExternalCapabilities(
  labels: string[],
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (!labels.length) return t('agents_external_disabled')
  if (labels.length === 1) return labels[0]
  const firstTwo = t('agents_external_summary_pair', {
    first: labels[0],
    second: labels[1],
  })
  if (labels.length === 2) return firstTwo
  return t('agents_external_summary_more', { items: firstTwo, count: labels.length })
}

function SessionDetailAction({
  icon,
  label,
  description,
  colors,
  onPress,
  divided = false,
  danger = false,
  disabled = false,
}: {
  icon: 'sliders' | 'folder' | 'edit-2' | 'trash-2' | 'rotate-ccw' | 'refresh-cw' | 'copy'
  label: string
  description?: string
  colors: Colors
  onPress: () => void
  divided?: boolean
  danger?: boolean
  disabled?: boolean
}) {
  const color = danger ? (Platform.OS === 'web' ? colors.error : colors.errorText) : colors.text
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      style={[
        styles.actionRow,
        divided && { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
      ]}
      onPress={onPress}
    >
      <Feather name={icon} size={19} color={danger ? colors.error : colors.textSecondary} />
      <View style={styles.actionText}>
        <Text
          numberOfLines={1}
          style={[styles.actionLabel, { color, opacity: disabled ? 0.5 : 1 }]}
        >
          {label}
        </Text>
        {description ? (
          <Text
            numberOfLines={1}
            style={[styles.actionDescription, { color: colors.textTertiary }]}
          >
            {description}
          </Text>
        ) : null}
      </View>
      {!danger ? <Feather name="chevron-right" size={18} color={colors.textTertiary} /> : null}
    </Pressable>
  )
}

function SessionRuntimeRow({
  label,
  value,
  colors,
  divided = false,
  middle = false,
}: {
  label: string
  value: string
  colors: Colors
  divided?: boolean
  middle?: boolean
}) {
  return (
    <View
      style={[
        styles.runtimeRow,
        divided && { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
      ]}
    >
      <Text style={[styles.runtimeLabel, { color: colors.textTertiary }]}>{label}</Text>
      <Text
        numberOfLines={1}
        ellipsizeMode={middle ? 'middle' : 'tail'}
        style={[styles.runtimeValue, { color: colors.text }]}
      >
        {value || '—'}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'flex-end',
    paddingHorizontal: 10,
    paddingBottom: 10,
  },
  inspectorOverlay: {
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
    paddingTop: 56,
    paddingRight: 16,
    paddingLeft: 16,
    backgroundColor: 'transparent',
  },
  sheet: {
    maxHeight: '90%',
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 12,
  },
  inspector: {
    width: 360,
    maxWidth: 360,
    alignSelf: 'flex-end',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingTop: 6,
    paddingBottom: 10,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.16,
    shadowRadius: 28,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(128,128,128,0.28)',
    marginBottom: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 38,
    marginBottom: 12,
  },
  inspectorHeader: { minHeight: 36, marginBottom: 8 },
  title: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  inspectorTitle: { fontSize: 15, lineHeight: 20 },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: { fontSize: 15 },
  summaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
  },
  inspectorCard: { borderRadius: 8, marginBottom: 8 },
  summaryIcon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryText: { flex: 1, minWidth: 0 },
  summaryTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    ...(Platform.OS !== 'web' && mobileTypography.listTitle),
  },
  summaryMeta: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
    ...(Platform.OS !== 'web' && mobileTypography.secondary),
  },
  summaryPath: {
    fontSize: 11,
    lineHeight: 15,
    marginTop: 2,
    ...(Platform.OS !== 'web' && mobileTypography.metadata),
  },
  sectionLabel: { marginLeft: 4, marginBottom: 7, fontSize: 12, lineHeight: 17 },
  runtimeCard: { borderRadius: 16, paddingHorizontal: 14, marginBottom: 12 },
  runtimeState: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  runtimeStateText: { fontSize: 13, lineHeight: 18 },
  runtimeRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 12 },
  runtimeLabel: { width: 74, fontSize: 13, lineHeight: 18 },
  runtimeValue: { flex: 1, textAlign: 'right', fontSize: 13, lineHeight: 18 },
  actionGroup: { borderRadius: 16, overflow: 'hidden' },
  restartGroup: { marginTop: 12 },
  dangerGroup: { borderRadius: 16, overflow: 'hidden', marginTop: 12 },
  actionRow: {
    minHeight: 54,
    paddingHorizontal: 15,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  actionText: { flex: 1, minWidth: 0 },
  actionLabel: {
    fontSize: 15,
    lineHeight: 20,
    ...(Platform.OS !== 'web' && mobileTypography.body),
  },
  actionDescription: { fontSize: 12, lineHeight: 17, marginTop: 1 },
})
