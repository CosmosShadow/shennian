// @arch docs/architecture/app/modular-features.md#机器-feature
// @test src/__tests__/machine-feature-utils.test.ts

import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Feather from '@expo/vector-icons/Feather'
import Ionicons from '@expo/vector-icons/Ionicons'
import type { Machine } from '@shennian/wire'
import { useTheme } from '../../../hooks/useTheme'
import { mobileTypography } from '../../../theme/mobileTypography'
import type { useMachineUpgrade } from '../hooks/useMachineUpgrade'
import { upgradeStyles } from '../styles'

export function MachineUpgradeDialog({ machine, onClose, model }: { machine: Machine; onClose: () => void; model: ReturnType<typeof useMachineUpgrade> }) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const { width, height } = useWindowDimensions()
  const { checkUpdate, currentProgressStepIndex, handleUpgrade, progressSteps, step } = model
  const [majorConfirmedVersion, setMajorConfirmedVersion] = useState<string | null>(null)
  const isWebDialog = Platform.OS === 'web' && width >= 768
  const dialogWidth = Math.min(Math.max(width * 0.5, 560), 760)
  const dialogMaxHeight = Math.min(height * 0.82, 780)

  return (
    <Modal
      visible
      transparent={isWebDialog}
      animationType={isWebDialog ? 'fade' : 'slide'}
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View
        style={[
          upgradeStyles.overlay,
          isWebDialog ? upgradeStyles.overlayDialog : null,
          { backgroundColor: isWebDialog ? 'rgba(15, 23, 42, 0.28)' : colors.bg },
        ]}
      >
        {isWebDialog ? <Pressable style={upgradeStyles.overlayBackdrop} onPress={onClose} /> : null}
        <View
          style={[
            upgradeStyles.container,
            isWebDialog ? upgradeStyles.dialogContainer : null,
            {
              backgroundColor: colors.bg,
              borderColor: isWebDialog ? colors.border : 'transparent',
              width: isWebDialog ? dialogWidth : '100%',
              maxHeight: isWebDialog ? dialogMaxHeight : undefined,
            },
          ]}
        >
        <View style={[upgradeStyles.header, { borderBottomColor: colors.border }]}>
          <Text style={[upgradeStyles.title, { color: colors.text }]}>{t('machine_upgrade_title')}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={t('close')} style={upgradeStyles.closeBtn} onPress={onClose}>
            <Feather name="x" size={20} color={colors.textTertiary} />
          </Pressable>
        </View>

        <ScrollView
          style={upgradeStyles.bodyScroll}
          contentContainerStyle={upgradeStyles.body}
          keyboardShouldPersistTaps="handled"
        >
          <View style={[upgradeStyles.infoCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[upgradeStyles.label, { color: colors.textSecondary }]}>{t('machine_upgrade_machine')}</Text>
            <Text style={[upgradeStyles.value, { color: colors.text }]}>{machine.name}</Text>
            <Text style={[upgradeStyles.label, { color: colors.textSecondary, marginTop: 10 }]}>{t('machine_upgrade_current_version')}</Text>
            <Text style={[upgradeStyles.value, { color: colors.text }]}>{machine.cliVersion ?? '—'}</Text>
            {step.step === 'ready' ? (
              <>
                <Text style={[upgradeStyles.label, { color: colors.textSecondary, marginTop: 10 }]}>{t('machine_upgrade_latest_version')}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={[upgradeStyles.value, { color: colors.text }]}>{step.latest}</Text>
                  <View
                    style={[
                      upgradeStyles.badge,
                      {
                        backgroundColor:
                          step.changeType === 'major'
                            ? colors.error + '20'
                            : step.changeType === 'minor'
                              ? '#f59e0b20'
                              : colors.success + '20',
                      },
                    ]}
                  >
                    <Text
                      style={[
                        upgradeStyles.badgeText,
                        {
                          color:
                            step.changeType === 'major'
                              ? colors.error
                              : step.changeType === 'minor'
                                ? '#f59e0b'
                                : colors.success,
                        },
                      ]}
                    >
                      {step.changeType}
                    </Text>
                  </View>
                </View>
              </>
            ) : null}
          </View>

          {step.step === 'checking' ? (
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <ActivityIndicator size="small" color={colors.brand} />
              <Text style={[{ color: colors.textSecondary, fontSize: 14 }, Platform.OS !== 'web' && mobileTypography.secondary]}>{t('machine_upgrade_checking')}</Text>
            </View>
          ) : null}

          {step.step === 'ready' && step.changeType === 'major' ? (
            <View style={[upgradeStyles.errorCard, { backgroundColor: '#f59e0b10', borderColor: '#f59e0b30' }]}>
              <Ionicons name="warning-outline" size={18} color="#f59e0b" />
              <Text style={{ color: colors.textSecondary, fontSize: 12, flex: 1, marginLeft: 8 }}>
                {t('machine_upgrade_major_warning')}
              </Text>
            </View>
          ) : null}

          {step.step === 'upToDate' ? (
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <Ionicons name="checkmark-circle" size={18} color={colors.success} />
              <Text style={[{ color: Platform.OS === 'web' ? colors.success : colors.successText, fontSize: 14 }, Platform.OS !== 'web' && mobileTypography.secondary]}>{t('machine_upgrade_up_to_date')}</Text>
            </View>
          ) : null}

          {step.step === 'upgrading' || step.step === 'success' ? (
            <View style={[upgradeStyles.progressCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              {progressSteps.map((progressStep, index) => {
                const isDone = step.step === 'success' || index < currentProgressStepIndex
                const isCurrent = step.step === 'upgrading' && index === currentProgressStepIndex

                return (
                  <View
                    key={progressStep.key}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}
                  >
                    {isDone ? (
                      <Ionicons name="checkmark-circle" size={16} color={colors.success} />
                    ) : isCurrent ? (
                      <ActivityIndicator size="small" color={colors.brand} />
                    ) : (
                      <View style={[upgradeStyles.dot, { borderColor: colors.border }]} />
                    )}
                    <Text style={{ color: isCurrent ? colors.text : colors.textTertiary, fontSize: 14 }}>
                      {progressStep.label}
                    </Text>
                  </View>
                )
              })}
              <Text style={{ color: colors.textTertiary, fontSize: 11 }}>
                {t('machine_upgrade_recovery_notice')}
              </Text>
            </View>
          ) : null}

          {step.step === 'success' ? (
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <Ionicons name="checkmark-circle" size={18} color={colors.success} />
              <Text style={{ color: colors.success, fontSize: 14 }}>
                {step.from !== step.to
                  ? t('machine_upgrade_success_versions', { from: step.from, to: step.to })
                  : t('machine_upgrade_up_to_date_version', { version: step.to })}
              </Text>
            </View>
          ) : null}

          {step.step === 'failed' ? (
            <View style={[upgradeStyles.errorCard, { backgroundColor: colors.error + '10', borderColor: colors.error + '30' }]}>
              <Ionicons name="alert-circle" size={18} color={colors.error} />
              <View style={{ flex: 1, marginLeft: 8 }}>
                <Text style={{ color: colors.error, fontWeight: '600', marginBottom: 2 }}>
                  {step.rolledBack ? t('machine_upgrade_failed_rolled_back') : t('machine_upgrade_failed')}
                </Text>
                <Text style={{ color: colors.textSecondary, fontSize: 12 }}>{step.error}</Text>
              </View>
            </View>
          ) : null}

          <View style={[upgradeStyles.manualCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[upgradeStyles.label, { color: colors.textSecondary }]}>{t('machine_upgrade_manual')}</Text>
            <Text style={[{ color: colors.textSecondary, fontSize: 12, marginBottom: 6 }, Platform.OS !== 'web' && mobileTypography.metadata]}>
              {t('machine_upgrade_manual_description')}
            </Text>
            <View style={[upgradeStyles.codeBlock, { backgroundColor: colors.bg }]}>
              <Text selectable style={[upgradeStyles.codeText, { color: colors.text }]}>
                shennian upgrade
              </Text>
            </View>
          </View>
        </ScrollView>

        <View style={[upgradeStyles.footer, { borderTopColor: colors.border }]}>
          {step.step === 'ready' ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={step.changeType === 'major' && majorConfirmedVersion !== step.latest
                ? t('machine_upgrade_confirm_major', { version: step.latest })
                : t('machine_upgrade_now', { version: step.latest })}
              style={[upgradeStyles.upgradeBtn, { backgroundColor: step.changeType === 'major' && majorConfirmedVersion !== step.latest ? '#f59e0b' : colors.brand }]}
              onPress={() => {
                if (step.changeType === 'major' && majorConfirmedVersion !== step.latest) {
                  setMajorConfirmedVersion(step.latest)
                  return
                }
                void handleUpgrade(majorConfirmedVersion)
              }}
            >
              <Text style={{ color: '#fff', fontWeight: '600', fontSize: 15 }}>
                {step.changeType === 'major' && majorConfirmedVersion !== step.latest
                  ? t('machine_upgrade_confirm_major', { version: step.latest })
                  : t('machine_upgrade_now', { version: step.latest })}
              </Text>
            </Pressable>
          ) : null}

          {step.step === 'failed' ? (
            <Pressable accessibilityRole="button" accessibilityLabel={t('retry')} style={[upgradeStyles.upgradeBtn, { backgroundColor: colors.brand }]} onPress={() => void checkUpdate()}>
              <Text style={{ color: '#fff', fontWeight: '600', fontSize: 15 }}>{t('retry')}</Text>
            </Pressable>
          ) : null}

          <Pressable accessibilityRole="button" accessibilityLabel={step.step === 'success' || step.step === 'upToDate' ? t('close') : t('cancel')} style={[upgradeStyles.cancelBtn, { borderColor: colors.border }]} onPress={onClose}>
            <Text style={[{ color: colors.textSecondary, fontSize: 14 }, Platform.OS !== 'web' && mobileTypography.body]}>
              {step.step === 'success' || step.step === 'upToDate' ? t('close') : t('cancel')}
            </Text>
          </Pressable>
        </View>
        </View>
      </View>
    </Modal>
  )
}
