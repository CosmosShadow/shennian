// @arch docs/features/free-growth-phase.md
// @test src/__tests__/machine-detail-source.test.ts
// @test src/__tests__/machine-primary-shortcut.test.ts

import { Pressable, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTranslation } from 'react-i18next'
import { filterAvailableAgentTypes, type Machine } from '@shennian/wire'
import { useTheme } from '../../../hooks/useTheme'
import { useMachineCardActions } from '../hooks/useMachineCardActions'
import { machineStyles } from '../styles'
import { getMachineOsLabel, isMachineCliVersionBlocked, MIN_RELAY_UPLOAD_CLI_VERSION } from '../utils/launch'
import { MachineNameRow } from './MachineNameRow'

export function MachineCard({
  machine,
  mode = 'launch',
  onExpand,
  compact = false,
  last = false,
  primary = false,
  onPrimaryPress,
}: {
  machine: Machine
  mode?: 'launch' | 'manage'
  expanded?: boolean
  onCollapse?: () => void
  onExpand?: () => void
  compact?: boolean
  last?: boolean
  primary?: boolean
  onPrimaryPress?: () => void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const actions = useMachineCardActions(machine, t)
  const showCompactManage = compact && mode === 'manage'
  const installedAgentCount = filterAvailableAgentTypes(machine.agentList).length
  const cliVersionBlocked = isMachineCliVersionBlocked(machine.cliVersion)

  return (
    <Pressable
      accessibilityRole={onExpand ? 'button' : undefined}
      accessibilityActions={showCompactManage && primary && onPrimaryPress
        ? [{ name: 'changePrimary', label: t('personal_primary_manage') }] : undefined}
      onAccessibilityAction={event => {
        if (event.nativeEvent.actionName === 'changePrimary') onPrimaryPress?.()
      }}
      accessibilityLabel={showCompactManage
        ? `${machine.name}${primary ? `, ${t('personal_primary_settings')}` : ''}, ${t(machine.online ? 'machine_online' : 'machine_offline')}, ${getMachineOsLabel(machine.os)}, ${t('machine_agents_count_short', { count: installedAgentCount })}`
        : undefined}
      style={[
        machineStyles.machineCard,
        showCompactManage ? machineStyles.machineCardCompact : null,
        { backgroundColor: showCompactManage ? colors.bg : colors.surface,
          borderColor: showCompactManage ? colors.groupedSeparator : colors.border,
          ...(showCompactManage && last ? { borderBottomWidth: 0 } : {}) },
      ]}
      onPress={onExpand}
      disabled={!onExpand}
    >
      <MachineNameRow
        machine={machine}
        actions={actions}
        compact={showCompactManage}
        agentCount={showCompactManage ? installedAgentCount : undefined}
        primary={primary}
        onPrimaryPress={onPrimaryPress}
      />
      {cliVersionBlocked ? (
        <View style={[machineStyles.oldCliHint, { backgroundColor: '#f59e0b0d', borderColor: '#f59e0b30' }]}>
          <Ionicons name="warning-outline" size={15} color="#f59e0b" />
          <Text style={[machineStyles.oldCliHintText, { color: '#b45309' }]}>
            {t('machine_cli_blocked_hint', {
              version: machine.cliVersion ?? t('unknown'),
              minVersion: MIN_RELAY_UPLOAD_CLI_VERSION,
            })}
          </Text>
        </View>
      ) : null}
    </Pressable>
  )
}
