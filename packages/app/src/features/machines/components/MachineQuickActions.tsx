// @arch docs/architecture/app/modular-features.md#机器-feature
// @test src/__tests__/machine-feature-utils.test.ts

import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import type { Machine } from '@shennian/wire'
import { DirBrowser } from '../../../components/DirBrowser'
import { AgentBadge } from '../../../components/AgentBadge'
import { useTheme } from '../../../hooks/useTheme'
import { useMachineLaunchState } from '../hooks/useMachineLaunchState'
import { machineStyles } from '../styles'

export function MachineQuickActions({
  machine,
  homeLabel,
  launchLabel,
  onExpand,
}: {
  machine: Machine
  homeLabel: string
  launchLabel: string
  onExpand: () => void
}) {
  const { colors } = useTheme()
  const launchState = useMachineLaunchState({
    machine,
    homeLabel,
    onLaunchError: () => onExpand(),
  })

  return (
    <View style={machineStyles.quickActions}>
      <View style={machineStyles.badgeRow}>
        {launchState.agentList.map((agent) => (
          <AgentBadge
            key={agent}
            agent={agent}
            displayName={launchState.getAgentLabel(agent)}
            selected={launchState.selectedAgent === agent}
            onPress={() => launchState.handleAgentSelect(agent)}
            disabled={launchState.launching}
          />
        ))}
      </View>

      <View style={[machineStyles.launchRow, machineStyles.quickLaunchRow]}>
        <Pressable
          onPress={() => launchState.setBrowseOpen(true)}
          style={[machineStyles.dirBtn, { borderColor: colors.border, backgroundColor: colors.bg }]}
          disabled={launchState.launching}
        >
          <Ionicons name="folder-outline" size={13} color={colors.textTertiary} />
          <Text style={[machineStyles.dirBtnText, { color: colors.textTertiary }]} numberOfLines={1}>
            {launchState.dirLabel}
          </Text>
        </Pressable>

        <Pressable
          style={[
            machineStyles.launchBtnFull,
            { flex: 1, backgroundColor: colors.brand },
            launchState.launching && { opacity: 0.6 },
          ]}
          onPress={() => void launchState.handleLaunch()}
          disabled={launchState.launching}
        >
          {launchState.launching ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={machineStyles.launchBtnText}>
              {launchLabel} {launchState.getAgentLabel(launchState.selectedAgent)}
            </Text>
          )}
        </Pressable>
      </View>

      {launchState.browseOpen ? (
        <DirBrowser
          machineId={machine.id}
          initialPath={launchState.workDir}
          mode="workDirPicker"
          onSelect={launchState.handleDirSelect}
          onClose={() => launchState.setBrowseOpen(false)}
        />
      ) : null}
    </View>
  )
}
