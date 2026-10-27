// @arch docs/design/desktop/unified-desktop-control.md
// @test ../../__tests__/desktop-machine-list-projection.test.ts

import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import type { Machine } from '@shennian/wire'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../hooks/useTheme'
import { useMachinePresentationState } from '../../hooks/useMachinePresentationState'
import { useRelayConnectivitySnapshot } from '../../hooks/useAppConnectivityStatus'
import { getMachineOsLabel } from '../machines/utils/launch'
import { groupInstalledAgents } from '../machines/utils/acp-agent-presentation'

export function DesktopMachineOverviewRow({
  machine,
  local,
  projectCount,
  onPress,
}: {
  machine: Machine
  local: boolean
  projectCount: number
  onPress(): void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const relay = useRelayConnectivitySnapshot()
  const presence = useMachinePresentationState(machine.online, relay?.phase ?? null)
  const [focused, setFocused] = useState(false)
  const [hovered, setHovered] = useState(false)
  const paused = Boolean(machine.remoteAccessDisabledAt)
  const status = paused ? 'paused' : presence
  const statusLabel = t(
    status === 'paused'
      ? 'machine_paused'
      : status === 'online'
        ? 'machine_online'
        : status === 'offline'
          ? 'machine_offline'
          : status === 'reconnecting'
            ? 'machine_reconnecting'
            : 'unknown',
  )
  const statusColor =
    status === 'online'
      ? colors.success
      : status === 'paused'
        ? colors.warning
        : colors.textTertiary
  const tools = groupInstalledAgents(machine).all.length
  const version = machine.cliVersion
    ? `v${machine.cliVersion.replace(/^v/i, '')}`
    : t('machine_version_unknown')
  const platformIcon = /darwin|mac/i.test(machine.os)
    ? 'logo-apple' : /win/i.test(machine.os) ? 'logo-windows' : 'desktop-outline'

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${machine.name}, ${statusLabel}`}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={({ pressed }) => [
        styles.row,
        {
          borderColor: focused ? colors.brand : colors.border,
          backgroundColor: hovered || pressed ? colors.surfaceHover : colors.bg,
          opacity: pressed ? 0.76 : 1,
        },
      ]}
    >
      <View style={[styles.platformIcon, { backgroundColor: colors.surfaceHover }]}>
        <Ionicons name={platformIcon} size={24} color={colors.textSecondary} />
      </View>
      <View style={styles.identity}>
        <View style={styles.nameLine}>
          <Text numberOfLines={1} style={[styles.name, { color: colors.text }]}>
            {machine.name}
          </Text>
          <View style={[styles.statusPill, { backgroundColor: colors.surfaceHover }]}>
            <View style={[styles.dot, { backgroundColor: statusColor }]} />
            <Text style={[styles.kind, { color: status === 'online' ? colors.successText : colors.textSecondary }]}>{statusLabel}</Text>
          </View>
        </View>
        <Text numberOfLines={1} style={[styles.metadata, { color: colors.text }]}>
          {getMachineOsLabel(machine.os)} · {t(local ? 'desktop_machine_local' : 'desktop_machine_remote')} · {version} ·{' '}
          {t('machine_agents_count_short', { count: tools })} ·{' '}
          {t('desktop_machine_projects_count', { count: projectCount })}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: {
    minHeight: 88,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  identity: { flex: 1, minWidth: 0, gap: 3 },
  platformIcon: { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { minWidth: 0, flexShrink: 1, fontSize: 16, lineHeight: 21, fontWeight: '600' },
  kind: { fontSize: 12, lineHeight: 17, fontWeight: '600' },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 12, paddingHorizontal: 9, paddingVertical: 3 },
  metadata: { fontSize: 13, lineHeight: 18, fontWeight: '500' },
  dot: { width: 7, height: 7, borderRadius: 4, flexShrink: 0 },
})
