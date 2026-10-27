// @arch docs/features/desktop-settings-information-architecture.md
// @arch docs/design/desktop/unified-desktop-control.md#设置页面
// @test ../../__tests__/desktop-device-revoke-dialog.test.ts

import { useRef } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { ProfileDevice } from '../account/profileAccountClient.types'
import { displayDeviceName } from '../profile/profileUtils'
import { useTheme } from '../../hooks/useTheme'
import { DesktopMachineAction } from '../desktop-machines/DesktopMachineAction'
import { DesktopDialog } from '../desktop-shell/DesktopDialog'
import { desktopTypography } from '../desktop-shell/desktopDesignTokens'

export function DesktopDeviceRevokeDialog({
  device,
  busy,
  onCancel,
  onConfirm,
}: {
  device: ProfileDevice | null
  busy: boolean
  onCancel(): void
  onConfirm(): void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const cancelRef = useRef<View>(null)
  if (!device) return null

  return (
    <DesktopDialog
      title={t('device_revoke_confirm')}
      onClose={onCancel}
      busy={busy}
      initialFocusRef={cancelRef}
    >
      <View testID="desktop-device-revoke-dialog" style={styles.content}>
        <Text style={[styles.device, { color: colors.text }]}>{displayDeviceName(device, t)}</Text>
        <Text style={[desktopTypography.body, { color: colors.textSecondary }]}>
          {t('device_revoke_confirm_desc')}
        </Text>
        <View style={styles.actions}>
          <DesktopMachineAction
            actionRef={cancelRef}
            compact
            label={t('cancel')}
            disabled={busy}
            onPress={onCancel}
          />
          <DesktopMachineAction
            compact
            destructive
            label={t('device_revoke')}
            disabled={busy}
            onPress={onConfirm}
          />
        </View>
      </View>
    </DesktopDialog>
  )
}

const styles = StyleSheet.create({
  content: { gap: 8 },
  device: { ...desktopTypography.control, fontWeight: '600', flexShrink: 1 },
  actions: {
    marginTop: 8,
    flexDirection: 'row',
    flexWrap: 'wrap-reverse',
    justifyContent: 'flex-end',
    gap: 8,
  },
})
