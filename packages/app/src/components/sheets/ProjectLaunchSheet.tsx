// @arch docs/architecture/session-organization.md
// @test open-source/packages/shared/src/__tests__/sheets-store.test.ts

import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useMachinesStore, useSheetsStore } from '@shennian/shared'
import type { Machine } from '@shennian/wire'
import BottomSheet from '../BottomSheet'
import { useTheme } from '../../hooks/useTheme'
import { useMachineLaunchState } from '../../features/machines/hooks/useMachineLaunchState'
import { machineStyles } from '../../features/machines/styles'
import { AgentBadge } from '../AgentBadge'
import { LaunchModelSelector } from '../../features/machines/components/LaunchModelSelector'

function ProjectLaunchContent({ machine, onClose }: { machine: Machine; onClose: () => void }) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const context = useSheetsStore((store) => store.projectLaunchContext)
  const launchState = useMachineLaunchState({
    machine,
    homeLabel: t('home_dir'),
    includeModelSelection: true,
    initialWorkDir: context?.workDir ?? '~',
    initialAgentType: context?.preferredAgentType ?? undefined,
    initialModelId: context?.preferredModelId ?? undefined,
    onLaunched: onClose,
  })
  const machineOffline = !machine.online

  if (!context) return null

  return (
    <>
      <View
        style={[
          styles.contextCard,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        <Text style={[styles.machineName, { color: colors.text }]} numberOfLines={1}>
          {machine.name}
        </Text>
        <Text style={[styles.workDir, { color: colors.textSecondary }]} numberOfLines={1}>
          {context.workDir}
        </Text>
      </View>

      <View style={machineStyles.cardSection}>
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

      {launchState.availableModels.length > 0 ? (
        <View style={[machineStyles.cardSection, styles.launchSelectionSection]}>
          <Text style={[machineStyles.launchSectionTitle, { color: colors.text }]}>
            {t('model')}
          </Text>
          <LaunchModelSelector
            agentType={launchState.selectedAgent}
            models={launchState.availableModels}
            selectedModel={launchState.selectedModel}
            disabled={launchState.launching}
            onSelectModel={launchState.handleModelSelect}
          />
        </View>
      ) : null}

      <View style={machineStyles.launchActions}>
        <Pressable
          style={[machineStyles.cancelBtn, { borderColor: colors.border }]}
          onPress={onClose}
        >
          <Text style={[machineStyles.cancelBtnText, { color: colors.textTertiary }]}>
            {t('cancel')}
          </Text>
        </Pressable>
        <Pressable
          style={[
            machineStyles.launchBtn,
            { backgroundColor: colors.brand },
            (launchState.launching || machineOffline) && { opacity: 0.6 },
          ]}
          onPress={() => {
            if (machineOffline) {
              launchState.setError(t('machine_offline_error'))
              return
            }
            void launchState.handleLaunch()
          }}
          disabled={launchState.launching}
        >
          {launchState.launching ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={machineStyles.launchBtnText}>
              {t('launch')} {launchState.getAgentLabel(launchState.selectedAgent)}
            </Text>
          )}
        </Pressable>
      </View>

      {launchState.error ? (
        <Text style={[machineStyles.errorText, { color: colors.error, marginTop: 6 }]}>
          {launchState.error}
        </Text>
      ) : null}
      {machineOffline ? (
        <Text style={[machineStyles.errorText, { color: colors.textTertiary, marginTop: 6 }]}>
          {t('machine_offline_restart_hint')}
        </Text>
      ) : null}
    </>
  )
}

export default function ProjectLaunchSheet() {
  const { t } = useTranslation()
  const isOpen = useSheetsStore((store) => store.projectLaunchOpen)
  const close = useSheetsStore((store) => store.closeProjectLaunch)
  const context = useSheetsStore((store) => store.projectLaunchContext)
  const machine = useMachinesStore((store) =>
    context ? store.machines.find((item) => item.id === context.machineId) : undefined,
  )

  if (!isOpen || !context || !machine) return null

  return (
    <BottomSheet isOpen={isOpen} onClose={close} title={t('new_conversation')} preferDialogOnWeb>
      <ProjectLaunchContent
        key={`${context.machineId}:${context.workDir}:${context.preferredAgentType ?? ''}:${context.preferredModelId ?? ''}`}
        machine={machine}
        onClose={close}
      />
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  launchSelectionSection: {
    gap: 8,
  },
  contextCard: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
    gap: 2,
  },
  machineName: {
    fontSize: 15,
    fontWeight: '600',
  },
  workDir: {
    fontSize: 12,
  },
})
