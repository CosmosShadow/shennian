// @arch docs/features/desktop-settings-information-architecture.md
// @test ../../__tests__/desktop-profile-presentation.test.ts
import type { ComponentProps } from 'react'
import { ActivityIndicator, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import type { ProfileDevicesCard } from '../profile/components/ProfileDevicesCard'
import type { ProfileDevice } from '../account/profileAccountClient.types'
import { displayDeviceName, platformIconName } from '../profile/profileUtils'
import { DesktopMachineAction } from '../desktop-machines/DesktopMachineAction'
import type { useTheme } from '../../hooks/useTheme'
import { desktopTypography } from '../desktop-shell/desktopDesignTokens'

type Props = Omit<ComponentProps<typeof ProfileDevicesCard>, 'devicesOpen' | 'handleToggleDevices' | 'embedded' | 'colors'> & {
  colors: ReturnType<typeof useTheme>['colors']
}

/** Keeps the protected current client visible first without rewriting server order. */
export function orderDesktopProfileDevices(devices: readonly ProfileDevice[]): ProfileDevice[] {
  return [
    ...devices.filter(device => device.current),
    ...devices.filter(device => !device.current),
  ]
}

export function DesktopProfileDevices(props: Props) {
  const { t, colors } = props
  const ordered = orderDesktopProfileDevices(props.devices)
  const otherDeviceCount = ordered.filter(device => !device.current).length
  return <View testID="desktop-signed-in-devices" style={{ width: '100%', minWidth: 0, gap: 16 }}>
    <View style={{ minWidth: 0, gap: 6 }}>
      <Text style={{ ...desktopTypography.body, color: colors.text, flexShrink: 1 }}>
        {t('account_security_body')}
      </Text>
      <Text style={{ ...desktopTypography.metadata, color: colors.textSecondary, flexShrink: 1 }}>
        {t('desktop_account_security_scope')}
      </Text>
      {props.devicesLoaded ? (
        <Text testID="desktop-device-count" style={{ ...desktopTypography.metadata, color: colors.textSecondary }}>
          {t('devices_count', { count: props.devices.length })}
        </Text>
      ) : null}
    </View>

    {props.devicesFailed ? (
      <View
        accessibilityLiveRegion="polite"
        style={{ minWidth: 0, gap: 8, paddingVertical: 4 }}
        testID="desktop-device-load-error"
      >
        <Text accessibilityRole="alert" style={{ ...desktopTypography.body, color: colors.errorText, flexShrink: 1 }}>
          {t('account_security_load_failed')}
        </Text>
        <DesktopMachineAction compact label={t('retry')} onPress={() => { void props.retryDevices() }} />
      </View>
    ) : null}

    {props.devicesLoading && !props.devicesLoaded ? (
      <View accessibilityLiveRegion="polite" style={{ minHeight: 44, justifyContent: 'center' }}>
        <ActivityIndicator color={colors.brand} />
      </View>
    ) : (
      <View
        accessibilityRole="list"
        style={{ overflow: 'hidden', borderWidth: 1, borderColor: colors.border, borderRadius: 12 }}
      >
        {ordered.map((device, index) => {
          const name = displayDeviceName(device, t)
          const activity = props.relativeTime(device.lastActiveAt)
          return (
            <View
              key={device.id}
              accessible={device.current}
              accessibilityLabel={device.current ? `${name}, ${activity}, ${t('device_current')}` : undefined}
              style={{
                minWidth: 0,
                minHeight: 64,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                paddingHorizontal: 16,
                paddingVertical: 10,
                borderTopWidth: index === 0 ? 0 : 1,
                borderTopColor: colors.border,
                backgroundColor: colors.bg,
              }}
              testID={`desktop-device-row-${device.id}`}
            >
              <Ionicons
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                name={platformIconName(device.platform.toLowerCase())}
                size={21}
                color={colors.textSecondary}
              />
              <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                <Text style={[desktopTypography.body, { color: colors.text, flexShrink: 1 }]}>{name}</Text>
                <Text style={[desktopTypography.metadata, { color: colors.textSecondary, flexShrink: 1 }]}>{activity}</Text>
              </View>
              {device.current ? (
                <View style={{ flexShrink: 0, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: colors.surfaceHover }}>
                  <Text style={[desktopTypography.metadata, { color: colors.textSecondary }]}>{t('device_current')}</Text>
                </View>
              ) : (
                <DesktopMachineAction
                  compact
                  label={t('device_revoke')}
                  destructive
                  disabled={props.revoking !== null}
                  onPress={() => props.confirmRevoke(device)}
                />
              )}
            </View>
          )
        })}
        {props.devicesLoaded && !props.devicesLoading && otherDeviceCount === 0 ? (
          <View style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 16, borderTopWidth: ordered.length ? 1 : 0, borderTopColor: colors.border }}>
            <Text style={{ ...desktopTypography.metadata, color: colors.textSecondary, flexShrink: 1 }}>
              {t('devices_empty_hint')}
            </Text>
          </View>
        ) : null}
      </View>
    )}
  </View>
}
