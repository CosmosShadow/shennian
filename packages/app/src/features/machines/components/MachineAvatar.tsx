// @arch docs/architecture/app/modular-features.md#机器-feature
// @test src/__tests__/machine-avatar.test.ts
import { StyleSheet, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import type { Machine } from '@shennian/wire'
import { useTheme } from '../../../hooks/useTheme'
import { machinePlatformAppearance } from '../utils/machinePlatformAppearance'

/** Shared identity for a specific computer; generic navigation icons are separate. */
export function MachineAvatar({ machine, hero = false }: {
  machine: Pick<Machine, 'os' | 'online' | 'remoteAccessDisabledAt'>
  hero?: boolean
}) {
  const { colors, isDark } = useTheme()
  const platform = machinePlatformAppearance(machine.os, isDark)
  const paused = Boolean(machine.remoteAccessDisabledAt)
  const statusColor = paused ? colors.warning : machine.online ? colors.success : colors.textTertiary
  return <View accessible={false} style={[
    styles.avatar, hero && styles.hero,
    { backgroundColor: platform.background, opacity: machine.online ? 1 : 0.55 },
  ]}>
    <Ionicons name={platform.icon} size={hero ? 32 : 24} color={platform.color} />
    <View style={[styles.status, { backgroundColor: statusColor, borderColor: colors.bg }]} />
  </View>
}
const styles = StyleSheet.create({
  avatar: { width: 44, height: 44, borderRadius: 12, flexShrink: 0, alignItems: 'center', justifyContent: 'center' },
  hero: { width: 56, height: 56, borderRadius: 15 },
  status: { position: 'absolute', right: -3, bottom: -3, width: 14, height: 14, borderRadius: 7, borderWidth: 2 },
})
