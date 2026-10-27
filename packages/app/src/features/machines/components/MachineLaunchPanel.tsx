// @arch docs/architecture/app/modular-features.md#机器-feature
// @test src/__tests__/machine-feature-utils.test.ts

import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import type { Machine } from '@shennian/wire'
import { DirBrowser } from '../../../components/DirBrowser'
import { AgentBadge } from '../../../components/AgentBadge'
import { useTheme } from '../../../hooks/useTheme'
import { useMachineLaunchState } from '../hooks/useMachineLaunchState'
import { machineStyles } from '../styles'

export function MachineLaunchPanel({
  machine,
  onClose,
  workingDirLabel,
  workingDirPlaceholder,
  cancelLabel,
  launchLabel,
  selectAgentLabel,
}: {
  machine: Machine
  onClose: () => void
  workingDirLabel: string
  workingDirPlaceholder: string
  cancelLabel: string
  launchLabel: string
  selectAgentLabel: string
}) {
  const { colors } = useTheme()
  const launchState = useMachineLaunchState({
    machine,
    homeLabel: '~',
  })

  return (
    <View
      style={[
        machineStyles.launchPanel,
        { borderColor: colors.brand + '30', backgroundColor: colors.brand + '06' },
      ]}
    >
      {launchState.agentList.length > 1 ? (
        <View style={{ marginBottom: 14 }}>
          <Text style={[machineStyles.sectionLabel, { color: colors.textSecondary }]}>
            {selectAgentLabel}
          </Text>
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
        </View>
      ) : null}

      <Text style={[machineStyles.sectionLabel, { color: colors.textSecondary }]}>
        {workingDirLabel}
      </Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TextInput
          value={launchState.workDir}
          onChangeText={launchState.setWorkDir}
          placeholder={workingDirPlaceholder}
          placeholderTextColor={colors.textTertiary}
          style={[
            machineStyles.textInput,
            { flex: 1, borderColor: colors.border, backgroundColor: colors.bg, color: colors.text },
          ]}
          editable={!launchState.launching}
        />
        <Pressable
          style={[
            machineStyles.browseBtn,
            { borderColor: colors.border, backgroundColor: colors.bg },
          ]}
          onPress={() => launchState.setBrowseOpen(true)}
          disabled={launchState.launching}
        >
          <Ionicons name="folder-outline" size={18} color={colors.brand} />
        </Pressable>
      </View>


      {launchState.error ? (
        <Text style={[machineStyles.errorText, { color: colors.errorText }]}>{launchState.error}</Text>
      ) : null}

      <View style={machineStyles.launchActions}>
        <Pressable
          style={[machineStyles.cancelBtn, { borderColor: colors.border }]}
          onPress={onClose}
        >
          <Text style={[machineStyles.cancelBtnText, { color: colors.textSecondary }]}>
            {cancelLabel}
          </Text>
        </Pressable>
        <Pressable
          style={[
            machineStyles.launchBtn,
            { backgroundColor: colors.brand },
            (!launchState.workDir.trim() || launchState.launching) && { opacity: 0.5 },
          ]}
          onPress={() => void launchState.handleLaunch()}
          disabled={launchState.launching || !launchState.workDir.trim()}
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
