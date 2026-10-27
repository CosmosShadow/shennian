// @arch docs/features/desktop-machine-pairing.md
// @arch docs/design/desktop/unified-desktop-control.md#全部页面清单与承载方式
// @test ../../__tests__/desktop-machine-pairing.test.ts

import Ionicons from '@expo/vector-icons/Ionicons'
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useMachinesStore } from '@shennian/shared'
import { useAuthStore } from '../../config/auth'
import { useTheme } from '../../hooks/useTheme'
import { getDesktopControlBridge } from '../desktop-control/bridge'
import { openDesktopClientInstallGuide } from './desktopClientInstallation'
import { ClientInstallGuide, SetupStepHeading } from '../machines/components/ClientInstallGuide'
import { SHENNIAN_MANUAL_INSTALL_URL } from '../machines/installPrompt'
import { DesktopMachinePairingModel } from './desktopMachinePairing'
import { DesktopMachinePortError, desktopMachinePort } from './desktopMachinePort'
import { DESKTOP_WORKSPACE_HEADER_HEIGHT } from '../desktop-shell/desktopWorkspaceMetrics'
import { desktopControlMetrics, desktopTypography } from '../desktop-shell/desktopDesignTokens'

type Navigation = { onBack?: () => void; onConnected?: (machineId: string) => void }

export default function DesktopAddMachineScreen(navigation: Navigation = {}) {
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  return accountId ? (
    <DesktopAddMachineContent key={accountId} accountId={accountId} {...navigation} />
  ) : null
}

function DesktopAddMachineContent({
  accountId,
  onBack,
  onConnected,
}: { accountId: string } & Navigation) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const router = useRouter()
  const { width } = useWindowDimensions()
  const compact = width < 760
  const [inputFocused, setInputFocused] = useState(false)
  const [buttonFocused, setButtonFocused] = useState(false)
  const [cancelFocused, setCancelFocused] = useState(false)
  const model = useMemo(
    () =>
      new DesktopMachinePairingModel({
        isCurrent: () => useAuthStore.getState().user?.id === accountId,
        claimPair: (token) => desktopMachinePort.claimPair(token),
        listMachines: () => desktopMachinePort.listMachines(),
        setMachines: (machines) => useMachinesStore.getState().setMachines(machines),
        isUnauthorized: (error) =>
          error instanceof DesktopMachinePortError && error.code === 'AUTH_REQUIRED',
        isConnectionFailure: (error) =>
          error instanceof DesktopMachinePortError &&
          (error.code === 'OFFLINE' || error.code === 'BRIDGE_UNAVAILABLE' || error.retryable),
        onInvite: (token) => router.navigate(`/machine-invites/${encodeURIComponent(token)}`),
        onConnected: (machineId) =>
          onConnected
            ? onConnected(machineId)
            : router.replace({
                pathname: '/(main)/machine/[machineId]',
                params: { machineId },
              }),
      }),
    [accountId, router, onConnected],
  )
  const state = useSyncExternalStore(model.subscribe, model.getState, model.getState)
  useEffect(() => model.start(), [model])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      if (onBack) onBack()
      else router.back()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [router, onBack])
  const busy = state.phase === 'claiming' || state.phase === 'refreshing'
  const submitDisabled = !state.input.trim() || state.phase !== 'idle'

  const openManualInstall = async () => {
    const bridge = getDesktopControlBridge()
    if (bridge && (await openDesktopClientInstallGuide(bridge, SHENNIAN_MANUAL_INSTALL_URL))) return
    window.open(SHENNIAN_MANUAL_INSTALL_URL, '_blank', 'noopener,noreferrer')
  }

  return (
    <View testID="desktop-add-machine" style={[styles.root, { backgroundColor: colors.bg }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('back')}
          onPress={onBack ?? (() => router.back())}
          style={({ pressed }) => [
            styles.back,
            { backgroundColor: pressed ? colors.surfaceHover : 'transparent' },
          ]}
        >
          <Ionicons
            name="arrow-back"
            size={desktopControlMetrics.iconGlyphSize}
            color={colors.text}
          />
        </Pressable>
        <View style={styles.headerCopy}>
          <Text accessibilityRole="header" style={[styles.headerTitle, { color: colors.text }]}>
            {t('add_machine')}
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scrollContent, compact && styles.scrollContentCompact]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.content}>
          <DesktopPairingStep index={1} title={t('setup_step_install')}>
            <ClientInstallGuide onOpenManualInstall={() => void openManualInstall()} />
          </DesktopPairingStep>

          <DesktopPairingStep index={2} title={t('setup_step_connect')}>
            <Text style={[styles.stepBody, { color: colors.text }]}>
              {t('desktop_add_machine_step_pair_body')}
            </Text>
            <View style={[styles.inputRow, compact && styles.inputRowCompact]}>
              <TextInput
                testID="desktop-machine-connection-input"
                accessibilityLabel={t('machine_code_placeholder')}
                editable={state.phase === 'idle'}
                value={state.input}
                onChangeText={model.setInput.bind(model)}
                onFocus={() => setInputFocused(true)}
                onBlur={() => setInputFocused(false)}
                onSubmitEditing={() => {
                  void model.submit()
                }}
                placeholder={t('machine_code_placeholder')}
                placeholderTextColor={colors.textTertiary}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
                autoFocus
                style={[
                  styles.input,
                  compact && styles.inputCompact,
                  {
                    color: colors.text,
                    backgroundColor: colors.bg,
                    borderColor: inputFocused ? colors.brand : colors.border,
                  },
                ]}
              />
              <Pressable
                testID="desktop-machine-cancel"
                accessibilityRole="button"
                accessibilityLabel={t('cancel')}
                onFocus={() => setCancelFocused(true)}
                onBlur={() => setCancelFocused(false)}
                onPress={onBack ?? (() => router.back())}
                style={({ pressed }) => [
                  styles.cancel,
                  compact && styles.compactAction,
                  {
                    borderColor: cancelFocused ? colors.brand : colors.border,
                    backgroundColor: pressed ? colors.surfaceHover : colors.surface,
                  },
                ]}
              >
                <Text style={[styles.cancelLabel, { color: colors.text }]}>{t('cancel')}</Text>
              </Pressable>
              <Pressable
                testID="desktop-machine-connect"
                accessibilityRole="button"
                accessibilityLabel={t('confirm_add_machine')}
                accessibilityState={{ busy, disabled: submitDisabled }}
                disabled={submitDisabled}
                onFocus={() => setButtonFocused(true)}
                onBlur={() => setButtonFocused(false)}
                onPress={() => {
                  void model.submit()
                }}
                style={({ pressed }) => [
                  styles.connect,
                  compact && styles.compactAction,
                  {
                    backgroundColor: colors.brand,
                    borderColor: buttonFocused ? colors.text : colors.brand,
                    opacity: submitDisabled ? 0.45 : pressed ? 0.78 : 1,
                  },
                ]}
              >
                {busy ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.connectLabel}>{t('confirm_add_machine')}</Text>
                )}
              </Pressable>
            </View>
            {state.error ? (
              <View
                accessibilityRole="alert"
                style={[styles.error, { backgroundColor: `${colors.error}0D` }]}
              >
                <Ionicons name="alert-circle-outline" size={18} color={colors.error} />
                <Text style={[styles.errorText, { color: colors.error }]}>
                  {t(errorKey(state.error))}
                </Text>
                {state.error === 'refresh-failed' ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('retry')}
                    onPress={() => {
                      void model.retryRefresh()
                    }}
                    style={styles.retry}
                  >
                    <Text style={{ color: colors.brand }}>{t('retry')}</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </DesktopPairingStep>
        </View>
      </ScrollView>
    </View>
  )
}

function errorKey(error: DesktopMachinePairingState['error']): string {
  if (error === 'authentication-required') return 'pair_auth_expired'
  if (error === 'refresh-failed') return 'desktop_add_machine_refresh_failed'
  if (error === 'invalid') return 'desktop_add_machine_invalid'
  if (error === 'connection-failed') return 'desktop_add_machine_connection_failed'
  return 'desktop_add_machine_pair_unavailable'
}

type DesktopMachinePairingState = ReturnType<DesktopMachinePairingModel['getState']>

function DesktopPairingStep({
  index,
  title,
  children,
}: {
  index: number
  title: string
  children: ReactNode
}) {
  const { colors } = useTheme()
  return (
    <View style={styles.step}>
      <SetupStepHeading index={index} title={title} />
      <View style={[styles.stepContent, { borderColor: colors.border, backgroundColor: colors.bg }]}>
        {children}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, minWidth: 0, minHeight: 0 },
  header: {
    minHeight: DESKTOP_WORKSPACE_HEADER_HEIGHT,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  back: {
    width: desktopControlMetrics.iconButtonSize,
    height: desktopControlMetrics.iconButtonSize,
    borderRadius: desktopControlMetrics.radiusControl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCopy: { minWidth: 0, flex: 1 },
  headerTitle: desktopTypography.windowTitle,
  scrollContent: { flexGrow: 1, paddingHorizontal: 32, paddingVertical: 40 },
  scrollContentCompact: { paddingHorizontal: 16, paddingVertical: 24 },
  content: { width: '100%', maxWidth: 860, alignSelf: 'center', gap: 28 },
  step: { gap: 12 },
  stepContent: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 24,
    gap: 16,
  },
  stepBody: { fontSize: 14, lineHeight: 20, fontWeight: '500' },
  inputRow: { flexDirection: 'row', alignItems: 'stretch', gap: 10 },
  inputRowCompact: { flexWrap: 'wrap' },
  input: {
    minWidth: 0,
    minHeight: 46,
    flex: 1,
    borderWidth: 1,
    borderRadius: 9,
    paddingHorizontal: 13,
    fontSize: 14,
    lineHeight: 20,
  },
  inputCompact: { flexBasis: '100%' },
  connect: {
    minWidth: 96,
    minHeight: 46,
    borderWidth: 2,
    borderRadius: 9,
    paddingHorizontal: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connectLabel: { color: '#fff', fontSize: 14, lineHeight: 20, fontWeight: '600' },
  cancel: {
    minWidth: 76,
    minHeight: 46,
    borderWidth: 2,
    borderRadius: 9,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelLabel: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  compactAction: { flexGrow: 1 },
  error: {
    minHeight: 44,
    borderRadius: 9,
    paddingHorizontal: 12,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  errorText: { minWidth: 0, flex: 1, fontSize: 13, lineHeight: 19 },
  retry: { minHeight: 44, paddingHorizontal: 10, justifyContent: 'center' },
})
