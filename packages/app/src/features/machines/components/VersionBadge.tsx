// @arch docs/architecture/app/modular-features.md#机器-feature
// @test src/__tests__/machine-feature-utils.test.ts

import { useState } from 'react'
import { Platform, Pressable, Text } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { Machine } from '@shennian/wire'
import { useTheme } from '../../../hooks/useTheme'
import { machineStyles } from '../styles'
import { useCliUpdateAvailable } from '../hooks/useCliUpdateAvailable'
import { UpgradeModal } from './UpgradeModal'

type ThemeColors = ReturnType<typeof useTheme>['colors']

export function VersionBadge({
  machine,
  colors,
  inline = false,
  canUpgrade = true,
}: {
  machine: Machine
  colors?: ThemeColors
  inline?: boolean
  canUpgrade?: boolean
}) {
  const { t } = useTranslation()
  const themeColors = useTheme().colors
  const resolvedColors = colors ?? themeColors
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const { hasUpdate, blocked: cliVersionBlocked } = useCliUpdateAvailable(machine)

  return (
    <>
      <Pressable
        onPress={(event) => {
          event.stopPropagation()
          if (canUpgrade) setUpgradeOpen(true)
        }}
        disabled={!canUpgrade}
        hitSlop={8}
        style={[
          inline ? machineStyles.versionInline : machineStyles.versionBadge,
          !inline && (hasUpdate || cliVersionBlocked) && { backgroundColor: '#f59e0b18' },
        ]}
        accessibilityRole={canUpgrade ? 'button' : undefined}
        accessibilityLabel={canUpgrade
          ? `${t('machine_connector_version_title')}, ${machine.cliVersion ?? t('machine_version_unknown')}`
          : undefined}
      >
        <Text
          style={[
            inline ? machineStyles.versionInlineText : machineStyles.versionText,
            {
              color: hasUpdate || cliVersionBlocked
                ? (Platform.OS === 'web' ? '#f59e0b' : resolvedColors.warningText)
                : (Platform.OS === 'web' ? resolvedColors.textTertiary : resolvedColors.textMuted),
            },
          ]}
        >
          {inline && machine.cliVersion
            ? `v${machine.cliVersion}`
            : machine.cliVersion
            ? t('machine_version_badge', { version: machine.cliVersion })
            : t('machine_version_unknown')}
          {cliVersionBlocked
            ? ` · ${t('machine_cli_upgrade_required_short')}`
            : hasUpdate
              ? ` · ${t('machine_cli_update_available_short')}`
              : ''}
        </Text>
      </Pressable>
      {upgradeOpen ? <UpgradeModal machine={machine} onClose={() => setUpgradeOpen(false)} /> : null}
    </>
  )
}
