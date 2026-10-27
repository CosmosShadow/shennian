import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import type { DeviceInfo } from '../profileUtils'
import { displayDeviceName, platformIconName } from '../profileUtils'
import { styles } from '../styles'

type ThemeColors = {
  brand: string
  error: string
  groupedSeparator: string
  surfaceHover: string
  textSecondary: string
  textTertiary: string
}

type DynamicStyles = {
  card: { backgroundColor: string; borderColor: string }
  rowLabel: { color: string }
  rowValue: { color: string }
  deviceRow: { borderTopColor: string }
  deviceName: { color: string }
  deviceTime: { color: string }
  revokeText: { color: string }
  currentBadge: { backgroundColor: string }
  currentText: { color: string }
}

type Props = {
  colors: ThemeColors
  confirmRevoke: (device: DeviceInfo) => void
  devices: DeviceInfo[]
  devicesLoaded: boolean
  devicesLoading: boolean
  devicesFailed: boolean
  devicesOpen: boolean
  ds: DynamicStyles
  handleToggleDevices: () => void
  retryDevices: () => Promise<void>
  iconColor: string
  revoking: string | null
  relativeTime: (date: string) => string
  t: (key: string, options?: { count: number }) => string
  embedded?: boolean
}

export function ProfileDevicesCard({
  colors,
  confirmRevoke,
  devices,
  devicesLoaded,
  devicesLoading,
  devicesFailed,
  devicesOpen,
  ds,
  handleToggleDevices,
  retryDevices,
  iconColor,
  revoking,
  relativeTime,
  t,
  embedded = false,
}: Props) {
  const content = (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: devicesOpen }}
        testID="profile-devices-toggle"
        onPress={handleToggleDevices}
      >
        <View style={styles.row}>
          <Ionicons name="phone-portrait-outline" size={20} color={iconColor} />
          <Text style={[styles.rowLabel, ds.rowLabel]}>{t('devices_title')}</Text>
          {devicesLoaded ? (
            <Text style={[styles.rowValue, styles.rowSummary, ds.rowValue]}>
              {t('devices_count', { count: devices.length })}
            </Text>
          ) : null}
          <Ionicons
            name={devicesOpen ? 'chevron-down' : 'chevron-forward'}
            size={16}
            color={colors.textTertiary}
          />
        </View>
      </Pressable>
      {devicesOpen ? (
        <View style={[styles.expandedSubsection, { backgroundColor: colors.surfaceHover }]}>
          {devicesLoading && !devicesLoaded ? (
            <View style={[styles.devicesEmpty, { borderTopColor: colors.groupedSeparator }]}>
              <ActivityIndicator size="small" color={colors.brand} />
            </View>
          ) : devicesFailed ? (
            <View
              accessibilityRole="alert"
              style={[styles.devicesEmpty, { borderTopColor: colors.groupedSeparator }]}
            >
              <Text style={[styles.devicesEmptyText, { color: colors.textSecondary }]}>
                {t('account_security_load_failed')}
              </Text>
              <Pressable
                testID="profile-devices-retry"
                accessibilityRole="button"
                onPress={() => void retryDevices()}
              >
                <Text style={[styles.devicesEmptyText, { color: colors.brand }]}>{t('retry')}</Text>
              </Pressable>
            </View>
          ) : devices.length > 0 ? (
            devices.map((device) => (
              <View key={device.id} style={[styles.deviceRow, ds.deviceRow]}>
                <Ionicons
                  name={platformIconName(device.platform)}
                  size={16}
                  color={colors.textTertiary}
                />
                <View style={styles.deviceInfo}>
                  <View style={styles.deviceNameRow}>
                    <Text style={[styles.deviceName, ds.deviceName]} numberOfLines={1}>
                      {displayDeviceName(device, t)}
                    </Text>
                    {device.current && (
                      <View style={[styles.currentBadge, ds.currentBadge]}>
                        <Text style={[styles.currentText, ds.currentText]}>
                          {t('device_current')}
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text style={[styles.deviceTime, ds.deviceTime]}>
                    {relativeTime(device.lastActiveAt)}
                  </Text>
                </View>
                {!device.current && (
                  <Pressable
                    onPress={() => confirmRevoke(device)}
                    accessibilityRole="button"
                    disabled={revoking === device.id}
                    style={styles.revokeBtn}
                  >
                    {revoking === device.id ? (
                      <ActivityIndicator size="small" color={colors.error} />
                    ) : (
                      <Text style={[styles.revokeText, ds.revokeText]}>{t('device_revoke')}</Text>
                    )}
                  </Pressable>
                )}
              </View>
            ))
          ) : (
            <View style={[styles.devicesEmpty, { borderTopColor: colors.groupedSeparator }]}>
              <Text style={[styles.devicesEmptyText, { color: colors.textSecondary }]}>
                {t('devices_empty_hint')}
              </Text>
            </View>
          )}
        </View>
      ) : null}
    </>
  )

  if (embedded) {
    return (
      <View style={[styles.embeddedGroup, { borderTopColor: colors.groupedSeparator }]}>
        {content}
      </View>
    )
  }

  return <View style={[styles.card, ds.card]}>{content}</View>
}
