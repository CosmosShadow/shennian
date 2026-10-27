// @arch docs/features/agent-workspaces.md#四信息架构
// @test src/__tests__/agent-participation-navigation.test.ts
import Ionicons from '@expo/vector-icons/Ionicons'
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { getAgentDisplayName, getProjectDirName, useMachinesStore } from '@shennian/shared'
import {
  managedAgentExecutionMode,
  resolveManagedAgentPermissionPolicy,
  type AgentWorkspace,
} from '@shennian/wire'
import { useAuthStore } from '../../config/auth'
import { useTheme } from '../../hooks/useTheme'
import { mobileTypography } from '../../theme/mobileTypography'
import { getMachineAgentModels, getModelDisplayName } from '../../utils/models'
import { RoomIdentityAvatar } from '../rooms/components/RoomIdentityAvatar'
import { managedAgentFileAccessKey } from './ManagedAgentPermissionSettings'

/** Owner-only identity/configuration summary. Never substitute it for a running Turn snapshot. */
export function AgentOverview({
  agent,
  onEdit,
  compact = false,
}: {
  agent: AgentWorkspace
  onEdit?: () => void
  compact?: boolean
}) {
  const { t, i18n } = useTranslation()
  const { colors } = useTheme()
  const owner = useAuthStore((state) => state.user)
  const machines = useMachinesStore((state) => state.machines)
  const machine = machines.find((item) => item.id === agent.machineId)
  const runtime = agent.runtimeAdapter
    ? getAgentDisplayName(agent.runtimeAdapter)
    : t('agents_unconfigured')
  const model = agent.runtimeAdapter
    ? (getModelDisplayName(getMachineAgentModels(machine, agent.runtimeAdapter), agent.modelId) ??
      agent.modelId ??
      t('agents_default_model'))
    : t('agents_default_model')
  const policy = resolveManagedAgentPermissionPolicy(agent.permissionPolicy, 'legacy')
  const permission =
    managedAgentExecutionMode(policy) === 'native-full'
      ? t('agents_run_access_full')
      : t(managedAgentFileAccessKey(policy.fileAccess))
  const location = [agent.machineName || machine?.name, getProjectDirName(agent.workDir)]
    .filter(Boolean)
    .join(' · ')
  return (
    <View
      testID="agent-detail-summary"
      style={[styles.root, compact && styles.compact, { borderBottomColor: colors.border }]}
    >
      <Pressable testID="agent-overview-edit" accessibilityRole={onEdit ? "button" : undefined}
        accessibilityLabel={onEdit ? Platform.OS === 'web' ? t('agents_edit') :
          i18n.language.startsWith('zh') ? '编辑 AI' : 'Edit AI' : undefined}
        disabled={!onEdit} onPress={onEdit} style={styles.identity}>
        <RoomIdentityAvatar
          name={agent.displayName}
          avatar={agent.avatar}
          agent
          ownerName={owner?.name}
          ownerAvatar={owner?.avatar}
          size={48}
        />
        <View style={styles.copy}>
          <Text style={[styles.name, compact && styles.compactName, { color: colors.text }]}>{agent.displayName}</Text>
          {agent.description ? (
            <Text style={[styles.description, { color: colors.textSecondary }]} numberOfLines={1} ellipsizeMode="tail">
              {agent.description}
            </Text>
          ) : null}
        </View>
        {onEdit ? <View style={styles.edit}><Ionicons name="chevron-forward" size={20} color={colors.textSecondary} /></View> : null}
      </Pressable>
      <Text testID="agent-detail-permission-summary" style={[styles.runtime, styles.metadata, { color: colors.textSecondary }]}>
        {[runtime, model, location, t(agent.sessionMode === 'manager' ? 'session_mode_manager' : 'session_mode_standard'), permission].filter(Boolean).join(' · ')}
      </Text>
    </View>
  )
}
const styles = StyleSheet.create({
  root: { paddingHorizontal: 16, paddingVertical: 24, borderBottomWidth: StyleSheet.hairlineWidth },
  compact: { paddingHorizontal: 0, paddingTop: 8, borderBottomWidth: 0 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  copy: { flex: 1, minWidth: 0 },
  name: { fontSize: 17, lineHeight: 22, fontWeight: '400', ...(Platform.OS !== 'web' && mobileTypography.listTitle) },
  compactName: { fontWeight: '600' },
  description: { fontSize: 13, lineHeight: 19, marginTop: 4, ...(Platform.OS !== 'web' && mobileTypography.secondary) },
  edit: { minWidth: 44, minHeight: 44, alignItems: 'flex-end', justifyContent: 'center' },
  runtime: { marginTop: 12 },
  metadata: { fontSize: 13, lineHeight: 19, ...(Platform.OS !== 'web' && mobileTypography.metadata) },
})
