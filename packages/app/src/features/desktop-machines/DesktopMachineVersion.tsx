// @arch docs/design/desktop/unified-desktop-control.md
// @test ../../__tests__/desktop-machine-detail.test.ts
import { Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { Machine } from '@shennian/wire'
import { useTheme } from '../../hooks/useTheme'
import { desktopTypography } from '../desktop-shell/desktopDesignTokens'
import { isMachineCliVersionBlocked } from '../machines/utils/launch'

/** A committed version label, not an upgrade trigger or version-checking controller. */
export function DesktopMachineVersion({ machine, colors }: { machine: Machine; colors?: ReturnType<typeof useTheme>['colors'] }) {
  const { t } = useTranslation()
  const theme = useTheme()
  const palette = colors ?? theme.colors
  const blocked = isMachineCliVersionBlocked(machine.cliVersion)
  return <View style={{ paddingTop: 4 }}>
    <Text style={[desktopTypography.metadata, { color: blocked ? palette.warningText : palette.textSecondary }]}>
      {machine.cliVersion ? t('machine_version_badge', { version: machine.cliVersion }) : t('machine_version_unknown')}
      {blocked ? ` · ${t('machine_cli_upgrade_required_short')}` : ''}
    </Text>
  </View>
}
