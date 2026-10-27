// @arch docs/features/desktop-settings-information-architecture.md#版本与更新
// @test src/__tests__/desktop-update-ui.test.ts

import Ionicons from '@expo/vector-icons/Ionicons'
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { useTheme } from '../../hooks/useTheme'
import type { useDesktopUpdateState } from '../desktop-control/hooks/useDesktopUpdateState'
import { formatDesktopUpdateSize, getDesktopUpdateActionIds } from './desktopUpdateActions'
import { VersionActionButton } from './versionPresentation'
import { desktopTypography } from '../desktop-shell/desktopDesignTokens'

type Colors = ReturnType<typeof useTheme>['colors']
type DesktopUpdate = ReturnType<typeof useDesktopUpdateState>

export type DesktopVersionSettingsProps = {
  colors: Colors
  label: string
  badge: boolean
  updateMessage: string
  desktopUpdate: DesktopUpdate
  restartImpactMessage: string
  showRestartConfirmation: boolean
  onInstallLater: () => void
  onRequestRestart: () => void
  onConfirmRestart: () => void
}

export function getDesktopUpdateRetryAction(
  update: Pick<DesktopUpdate, 'retryOperation' | 'check' | 'download'>,
) {
  return update.retryOperation === 'download' ? update.download : update.check
}

export function DesktopVersionSettings(props: DesktopVersionSettingsProps) {
  const { t } = useTranslation()
  const { colors, desktopUpdate, label } = props
  const state = desktopUpdate.state
  const busy = desktopUpdate.operation !== null
  const checking = state?.status === 'checking' || desktopUpdate.operation === 'check'
  const downloading = state?.status === 'downloading'
  const verifying = state?.status === 'verifying'
  const downloaded = state?.status === 'downloaded'
  const available = state?.status === 'available'
  const failed = state?.status === 'error'
  const sizeLabel = formatDesktopUpdateSize(
    state?.status === 'downloading'
      ? state.total
      : state?.status === 'available' || state?.status === 'downloaded'
        ? state.sizeBytes
        : undefined,
  )
  const actions = getDesktopUpdateActionIds({
    state,
    operation: desktopUpdate.operation,
    retryOperation: desktopUpdate.retryOperation,
    confirmingRestart: props.showRestartConfirmation,
  })
  const showDetails =
    available || downloading || verifying || downloaded || failed || props.showRestartConfirmation

  return (
    <View testID="desktop-version-settings" style={styles.root}>
      <View style={[styles.group, { borderColor: colors.border, backgroundColor: colors.bg }]}>
        <View style={styles.productRow}>
          <Image
            source={require('../../../public/logo-192.png')}
            style={styles.appMark}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
          <View style={styles.productCopy}>
            <Text style={[styles.productName, { color: colors.text }]}>Shennian Desktop</Text>
            <Text style={[styles.meta, { color: colors.textSecondary }]}>
              {label} · {showDetails ? statusTitle() : t('desktop_update_installed')}
            </Text>
          </View>
          {props.badge ? (
            <View style={[styles.updateDot, { backgroundColor: colors.error }]} />
          ) : null}
          {checking || verifying || desktopUpdate.operation === 'install-now' ? (
            <ActivityIndicator color={colors.brand} />
          ) : null}
          {actions.includes('check') ? (
            <VersionActionButton
              label={checking ? t('desktop_update_checking') : t('desktop_update_check')}
              disabled={busy || checking}
              onPress={() => void desktopUpdate.check()}
              colors={colors}
            />
          ) : null}
        </View>
        {showDetails ? (
          <View style={[styles.detailRow, { borderTopColor: colors.border }]}>
            <Ionicons
              name={
                failed
                  ? 'alert-circle-outline'
                  : downloaded
                    ? 'checkmark-circle-outline'
                    : 'arrow-down-circle-outline'
              }
              size={22}
              color={failed ? colors.error : downloaded ? colors.success : colors.textSecondary}
            />
            <View style={styles.statusCopy}>
              <Text
                accessibilityRole={failed ? 'alert' : undefined}
                style={[styles.statusTitle, { color: failed ? colors.errorText : colors.text }]}
              >
                {statusTitle()}
              </Text>
              {state && 'version' in state && state.version ? (
                <Text style={[styles.message, { color: colors.textSecondary }]}>
                  {state.version}
                  {sizeLabel ? ` · ${t('desktop_update_size', { size: sizeLabel })}` : ''}
                </Text>
              ) : null}
              {failed ? (
                <Text accessibilityRole="alert" style={[styles.message, { color: colors.errorText }]}>
                  {props.updateMessage}
                </Text>
              ) : null}
              {(state?.status === 'available' || state?.status === 'downloaded') &&
              state.releaseNotes ? (
                <Text style={[styles.notes, { color: colors.textSecondary }]}>
                  {state.releaseNotes}
                </Text>
              ) : null}
              {downloading ? (
                <View
                  accessibilityRole="progressbar"
                  accessibilityValue={{ min: 0, max: 100, now: Math.round(state.percent) }}
                >
                  <View style={[styles.progressTrack, { backgroundColor: colors.surfaceHover }]}>
                    <View
                      style={[
                        styles.progressFill,
                        { backgroundColor: colors.brand, width: `${state.percent}%` },
                      ]}
                    />
                  </View>
                  <Text style={[styles.progressLabel, { color: colors.textSecondary }]}>
                    {t('desktop_update_progress', { percent: Math.round(state.percent) })}
                  </Text>
                </View>
              ) : null}
              {verifying ? (
                <Text style={[styles.message, { color: colors.textSecondary }]}>
                  {t('desktop_update_verifying_detail')}
                </Text>
              ) : null}
              {props.showRestartConfirmation ? (
                <Text
                  accessibilityRole="alert"
                  style={[styles.warning, { color: colors.warningText }]}
                >
                  {props.restartImpactMessage}
                </Text>
              ) : null}
            </View>
            <View style={styles.actions}>{renderActions()}</View>
          </View>
        ) : null}
      </View>
    </View>
  )

  function statusTitle() {
    if (downloaded) return t('desktop_update_ready')
    if (downloading) return t('desktop_update_downloading')
    if (verifying) return t('desktop_update_verifying')
    if (available) return t('desktop_update_available')
    if (failed) return t('desktop_update_failed')
    return t('desktop_update_status')
  }

  function renderActions() {
    if (actions.includes('download')) {
      return (
        <VersionActionButton
          label={t('desktop_update_download')}
          primary
          disabled={busy}
          onPress={() => void desktopUpdate.download()}
          colors={colors}
        />
      )
    }
    if (actions.includes('retry-check') || actions.includes('retry-download')) {
      return (
        <VersionActionButton
          label={t('desktop_update_retry')}
          primary
          disabled={busy}
          onPress={() => void getDesktopUpdateRetryAction(desktopUpdate)()}
          colors={colors}
        />
      )
    }
    if (actions.includes('install-later')) {
      return (
        <>
          <VersionActionButton
            label={t('desktop_update_later')}
            disabled={busy}
            onPress={props.onInstallLater}
            colors={colors}
          />
          <VersionActionButton
            label={t('desktop_update_restart_confirm')}
            primary
            disabled={busy}
            onPress={props.onConfirmRestart}
            colors={colors}
          />
        </>
      )
    }
    if (!actions.includes('install-now') || state?.status !== 'downloaded') return null
    return (
      <>
        {actions.includes('install-on-quit') ? (
          <VersionActionButton
            label={
              state.installOnExit
                ? t('desktop_update_on_quit_scheduled')
                : t('desktop_update_on_quit')
            }
            disabled={busy || state.installOnExit}
            onPress={() => void desktopUpdate.installOnExit()}
            colors={colors}
          />
        ) : null}
        <VersionActionButton
          label={t('desktop_update_restart')}
          primary
          disabled={busy}
          onPress={props.onRequestRestart}
          colors={colors}
        />
      </>
    )
  }
}

const styles = StyleSheet.create({
  root: { width: '100%' },
  group: {
    width: '100%',
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
  },
  productRow: {
    minHeight: 68,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  appMark: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  productCopy: { flex: 1, minWidth: 0, gap: 2 },
  productName: { ...desktopTypography.body, fontWeight: '500' },
  meta: { ...desktopTypography.metadata, marginTop: 2 },
  updateDot: { width: 7, height: 7, borderRadius: 4 },
  detailRow: {
    minHeight: 64,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  statusCopy: { flex: 1, minWidth: 180, gap: 8 },
  statusTitle: { ...desktopTypography.body, fontWeight: '500' },
  message: desktopTypography.metadata,
  notes: { ...desktopTypography.body, whiteSpace: 'pre-wrap' } as never,
  progressTrack: { height: 7, borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: 7, borderRadius: 4 },
  progressLabel: { ...desktopTypography.metadata, marginTop: 6 },
  warning: desktopTypography.body,
  actions: {
    minWidth: 150,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: 8,
  },
})
