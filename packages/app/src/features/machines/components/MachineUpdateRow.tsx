// @arch docs/architecture/app/modular-features.md#机器-feature
// @test src/__tests__/machine-detail-source.test.ts

import { useState } from 'react'
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import Ionicons from '@expo/vector-icons/Ionicons'
import type { Machine } from '@shennian/wire'
import { useTheme } from '../../../hooks/useTheme'
import { mobileTypography } from '../../../theme/mobileTypography'
import { useCliUpdateAvailable } from '../hooks/useCliUpdateAvailable'
import { UpgradeModal } from './UpgradeModal'

type ThemeColors = ReturnType<typeof useTheme>['colors']

/**
 * Whole-row update entry shown inside the client card only when a newer Shennian CLI exists.
 * Only the owner of an online machine can act on it; everyone else sees the same fact as plain text.
 */
export function MachineUpdateRow({
  machine,
  colors,
  isOwner,
}: {
  machine: Machine
  colors: ThemeColors
  isOwner: boolean
}) {
  const { t } = useTranslation()
  const { latestVersion, hasUpdate } = useCliUpdateAvailable(machine)
  const [upgradeOpen, setUpgradeOpen] = useState(false)

  if (!hasUpdate || !latestVersion) return null

  const canUpdate = isOwner && machine.online
  const found = t('machine_cli_update_found', { version: latestVersion })
  const divider = { borderTopColor: colors.border }

  if (!isOwner) {
    return (
      <View style={[styles.row, divider]}>
        <Text style={[styles.title, { color: colors.textSecondary }]}>{found}</Text>
      </View>
    )
  }

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('machine_cli_update_to', { version: latestVersion })}
        accessibilityState={{ disabled: !canUpdate }}
        disabled={!canUpdate}
        onPress={() => setUpgradeOpen(true)}
        style={({ pressed }) => [
          styles.row,
          divider,
          pressed && { backgroundColor: colors.surfaceHover },
        ]}
      >
        <View style={styles.body}>
          <Text style={[styles.title, { color: colors.text }]}>{found}</Text>
          {!machine.online ? (
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              {t('machine_cli_update_offline')}
            </Text>
          ) : null}
        </View>
        {canUpdate ? (
          <>
            <Text style={[styles.action, { color: colors.brand }]}>
              {t('machine_cli_update_action')}
            </Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
          </>
        ) : null}
      </Pressable>
      {upgradeOpen ? (
        <UpgradeModal machine={machine} onClose={() => setUpgradeOpen(false)} />
      ) : null}
    </>
  )
}

const styles = StyleSheet.create({
  row: {
    minHeight: 44,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  body: { flex: 1, minWidth: 0 },
  title: { fontSize: 15, lineHeight: 20, ...(Platform.OS !== 'web' && mobileTypography.body) },
  subtitle: {
    marginTop: 2,
    fontSize: 13,
    lineHeight: 18,
    ...(Platform.OS !== 'web' && mobileTypography.metadata),
  },
  action: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
    ...(Platform.OS !== 'web' && mobileTypography.compactAction),
  },
})
