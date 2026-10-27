// @arch docs/design/desktop/macos-interaction-baseline.md
// @test ../../__tests__/desktop-machine-upgrade.test.ts
import { useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTranslation } from 'react-i18next'
import type { Machine } from '@shennian/wire'
import { useTheme } from '../../hooks/useTheme'
import { DesktopDialog } from '../desktop-shell/DesktopDialog'
import { desktopTypography } from '../desktop-shell/desktopDesignTokens'
import { DesktopMachineAction } from './DesktopMachineAction'
import type { useDesktopMachineUpgrade } from './useDesktopMachineUpgrade'

export function DesktopMachineUpgradeDialog({ machine, model, onClose }: {
  machine: Machine
  model: ReturnType<typeof useDesktopMachineUpgrade>
  onClose(): void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const { step, progressSteps, currentProgressStepIndex } = model
  const [confirmedVersion, setConfirmedVersion] = useState<string | null>(null)
  const needsConfirmation = step.step === 'ready' && step.changeType === 'major' && confirmedVersion !== step.latest
  const body = [desktopTypography.body, { color: colors.textSecondary }]
  return <DesktopDialog title={`${t('machine_upgrade_title')} · ${machine.name}`} onClose={onClose}>
    <View style={styles.stack}>
      <View style={[styles.versionRow, { borderColor: colors.border }]}>
        <Text style={body}>{t('machine_upgrade_current_version')}</Text>
        <Text selectable style={[desktopTypography.body, { color: colors.text }]}>{machine.cliVersion ?? '—'}</Text>
      </View>
      {step.step === 'ready' ? <View style={[styles.versionRow, { borderColor: colors.border }]}>
        <Text style={body}>{t('machine_upgrade_latest_version')}</Text>
        <Text selectable style={[desktopTypography.body, { color: colors.text }]}>{step.latest}</Text>
      </View> : null}
      {step.step === 'checking' ? <View style={styles.status}>
        <ActivityIndicator size="small" color={colors.brand} />
        <Text accessibilityLiveRegion="polite" style={[body, styles.copy]}>{t('machine_upgrade_checking')}</Text>
      </View> : null}
      {step.step === 'ready' && step.changeType === 'major' ? <View style={styles.status}>
        <Ionicons name="warning-outline" size={18} color={colors.warningText} />
        <Text style={[desktopTypography.body, styles.copy, { color: colors.warningText }]}>{t('machine_upgrade_major_warning')}</Text>
      </View> : null}
      {step.step === 'upToDate' || step.step === 'success' ? <View style={styles.status}>
        <Ionicons name="checkmark-circle-outline" size={18} color={colors.successText} />
        <Text accessibilityLiveRegion="polite" style={[desktopTypography.body, styles.copy, { color: colors.successText }]}>
          {step.step === 'upToDate' ? t('machine_upgrade_up_to_date') : step.from !== step.to
            ? t('machine_upgrade_success_versions', { from: step.from, to: step.to })
            : t('machine_upgrade_up_to_date_version', { version: step.to })}
        </Text>
      </View> : null}
      {step.step === 'upgrading' || step.step === 'success' ? <View style={styles.progress}>
        {progressSteps.map((item, index) => {
          const done = step.step === 'success' || index < currentProgressStepIndex
          const current = step.step === 'upgrading' && index === currentProgressStepIndex
          return <View key={item.key} style={styles.status}>
            {current ? <ActivityIndicator size="small" color={colors.brand} />
              : <Ionicons name={done ? 'checkmark-circle-outline' : 'ellipse-outline'} size={16} color={done ? colors.successText : colors.textSecondary} />}
            <Text style={[desktopTypography.body, styles.copy, { color: current ? colors.text : colors.textSecondary }]}>{item.label}</Text>
          </View>
        })}
        <Text style={body}>{t('machine_upgrade_recovery_notice')}</Text>
      </View> : null}
      {step.step === 'failed' ? <View accessibilityRole="alert" style={styles.progress}>
        <Text style={[desktopTypography.body, { color: colors.errorText }]}>{t(step.rolledBack ? 'machine_upgrade_failed_rolled_back' : 'machine_upgrade_failed')}</Text>
        <Text selectable style={body}>{step.error}</Text>
      </View> : null}
      <View style={styles.progress}>
        <Text style={[desktopTypography.sectionTitle, { color: colors.text }]}>{t('machine_upgrade_manual')}</Text>
        <Text style={body}>{t('desktop_machine_upgrade_manual_description')}</Text>
        <Text selectable style={[styles.command, { color: colors.text, backgroundColor: colors.surface }]}>shennian upgrade</Text>
      </View>
      <View style={styles.actions}>
        <DesktopMachineAction compact label={t('close')} onPress={onClose} />
        {step.step === 'failed' ? <DesktopMachineAction compact primary label={t('retry')} onPress={() => void model.checkUpdate()} /> : null}
        {step.step === 'ready' ? <DesktopMachineAction compact primary
          label={t(needsConfirmation ? 'machine_upgrade_confirm_major' : 'machine_upgrade_now', { version: step.latest })}
          onPress={() => {
            if (needsConfirmation) { setConfirmedVersion(step.latest); return }
            void model.handleUpgrade(confirmedVersion)
          }} /> : null}
      </View>
    </View>
  </DesktopDialog>
}

const styles = StyleSheet.create({
  stack: { gap: 16 },
  versionRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  status: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  copy: { flex: 1, minWidth: 0 },
  progress: { gap: 8 },
  command: { ...desktopTypography.code, fontFamily: 'monospace', padding: 8, borderRadius: 6 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8 },
})
