// @arch docs/design/desktop/unified-desktop-control.md
// @test ../../__tests__/desktop-project-launch-sheet.test.ts
import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useSheetsStore } from '@shennian/shared'
import type { Machine } from '@shennian/wire'
import { useAuthStore } from '../../config/auth'
import { useTheme } from '../../hooks/useTheme'
import { DesktopMachineListState } from '../desktop-machines/DesktopMachineListState'
import { useDesktopMachineListModel } from '../desktop-machines/useDesktopMachineListModel'
import { DesktopAgentChoices, DesktopModelChoices } from './DesktopLaunchChoices'
import { DesktopLaunchDialog } from './DesktopLaunchDialog'
import { useDesktopProjectLaunchState } from './useDesktopProjectLaunchState'
import { createDesktopLaunchSheetLifetime } from './desktopLaunchSheetLifetime'

type ProjectLaunchContext = NonNullable<ReturnType<typeof useSheetsStore.getState>['projectLaunchContext']>

export function DesktopProjectLaunchSheet() {
  const lifetime = useMemo(() => createDesktopLaunchSheetLifetime({
    account: () => useAuthStore.getState().user?.id ?? null,
    context: () => useSheetsStore.getState().projectLaunchContext,
    subscribeAccount: listener => useAuthStore.subscribe(listener),
    close: () => useSheetsStore.getState().closeProjectLaunch(),
  }), [])
  useEffect(() => lifetime.start(), [lifetime])
  const accountId = useAuthStore(state => state.user?.id ?? null)
  const isOpen = useSheetsStore(state => state.projectLaunchOpen)
  const context = useSheetsStore(state => state.projectLaunchContext)
  const close = useSheetsStore(state => state.closeProjectLaunch)
  if (!isOpen || !context || !accountId) return null
  return <DesktopLaunchProjection key={`${accountId}:${JSON.stringify(context)}`} context={context} onClose={close} />
}

function DesktopLaunchProjection({ context, onClose }: { context: ProjectLaunchContext; onClose(): void }) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const { machines, surface, retry } = useDesktopMachineListModel()
  const machine = machines.find(item => item.id === context.machineId)
  const title = context.projectName
    ? `${context.projectName} · ${t('new_conversation')}`
    : t('new_conversation')
  return <DesktopLaunchDialog onClose={onClose} title={title}>
    {machine ? <DesktopLaunchContent machine={machine} context={context} inventorySurface={surface} onClose={onClose} />
      : surface === 'initial-loading' || surface === 'offline' || surface === 'forbidden' || surface === 'error'
        ? <DesktopMachineListState state={surface} compact={false} onRetry={retry} />
        : <Text accessibilityRole="alert" style={{ color: colors.textSecondary }}>{t('machine_not_found')}</Text>}
  </DesktopLaunchDialog>
}

function DesktopLaunchContent({ machine, context, inventorySurface, onClose }: {
  machine: Machine
  context: ProjectLaunchContext
  inventorySurface: ReturnType<typeof useDesktopMachineListModel>['surface']
  onClose(): void
}) {
  const state = useDesktopProjectLaunchState({
    machine,
    workDir: context.workDir,
    initialAgentType: context.preferredAgentType ?? undefined,
    initialModelId: context.preferredModelId,
    inventorySurface,
    onLaunched: onClose,
  })
  const { t } = useTranslation()
  const { colors } = useTheme()
  return <View style={styles.content}>
    <View style={[styles.context, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      <Text style={[styles.machineName, { color: colors.text }]} numberOfLines={1}>{machine.name}</Text>
      <Text style={{ color: colors.textSecondary }} numberOfLines={1}>{context.workDir}</Text>
    </View>
    {state.agentList.length > 0 ? <>
      <DesktopAgentChoices agents={state.agentList} selected={state.selectedAgent} disabled={state.launching}
        getLabel={state.getAgentLabel} onSelect={state.handleAgentSelect} />
      <DesktopModelChoices models={state.availableModels} selected={state.selectedModel}
        disabled={state.launching} onSelect={state.handleModelSelect} />
    </> : null}
    {state.error ? <Text accessibilityRole="alert" style={{ color: colors.error }}>{state.error}</Text> : null}
    {!state.canLaunch && !state.error ? <View accessibilityLiveRegion="polite" style={styles.availability}>
      <Text style={{ color: colors.textSecondary }}>
        {t(state.availabilityKey ?? 'connecting')}
      </Text>
      {state.agentList.length === 0 && machine.online && !machine.remoteAccessDisabledAt
        ? <LaunchButton label={t('agents_validation_retry')} disabled={state.refreshingTools}
          onPress={() => { void state.handleRefreshTools() }} /> : null}
    </View> : null}
    <View style={styles.actions}>
      <LaunchButton label={t('cancel')} onPress={onClose} />
      <LaunchButton label={t('start_new_chat')}
        disabled={state.launching || !state.canLaunch} onPress={() => { void state.handleLaunch() }} />
      {state.launching ? <ActivityIndicator accessibilityLabel={t('launch')} color={colors.brand} /> : null}
    </View>
  </View>
}

function LaunchButton({ label, disabled = false, onPress }: { label: string; disabled?: boolean; onPress(): void }) {
  const { colors } = useTheme()
  const [focused, setFocused] = useState(false)
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.button, {
      borderColor: focused ? colors.brand : colors.border, backgroundColor: pressed ? colors.surfaceHover : colors.bg,
      opacity: disabled ? 0.5 : 1,
    }]}>
    <Text style={{ color: colors.text }}>{label}</Text>
  </Pressable>
}

const styles = StyleSheet.create({
  content: { gap: 16 },
  context: { gap: 4, padding: 12, borderWidth: 1, borderRadius: 12 },
  machineName: { fontSize: 15, fontWeight: '600' },
  availability: { gap: 8, alignItems: 'flex-start' },
  actions: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end', alignItems: 'center' },
  button: { minWidth: 88, minHeight: 44, paddingHorizontal: 14, borderWidth: 2, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
})
