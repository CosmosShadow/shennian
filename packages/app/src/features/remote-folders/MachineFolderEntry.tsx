// @arch docs/architecture/remote-folders.md
// @test packages/app/src/__tests__/remote-folders.test.ts
import { Pressable, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useRouter } from 'expo-router'
import Ionicons from '@expo/vector-icons/Ionicons'
import type { Machine } from '@shennian/wire'
import { useTheme } from '../../hooks/useTheme'
import { canBrowseFolders } from './model'
import { mobileTypography } from '../../theme/mobileTypography'

export function MachineFolderEntry({ machine, compact = false }: { machine: Machine; compact?: boolean }) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const router = useRouter()
  if (machine.role === 'granted') return null
  const enabled = canBrowseFolders(machine) && machine.online
  return <Pressable accessibilityRole="button" accessibilityLabel={t('remote_folder_add')} testID="machine-add-folder"
    disabled={!enabled} accessibilityState={{ disabled: !enabled }}
    onPress={() => router.navigate({ pathname: '/(main)/machine-folder', params: { machineId: machine.id } })}
    style={{ minHeight: 64, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12, opacity: enabled ? 1 : 0.5, borderTopWidth: compact ? 0 : 0.5, borderTopColor: colors.border }}>
    {!compact ? <Ionicons name="folder-open-outline" size={24} color={colors.brand} /> : null}
    <View style={{ flex: 1, gap: 4 }}>
      <Text style={{ ...(compact ? mobileTypography.body : mobileTypography.secondary), color: colors.text }}>{t('remote_folder_add')}</Text>
      {!compact ? <Text style={{ ...mobileTypography.metadata, color: colors.textSecondary }}>{t('remote_folder_machine_hint')}</Text> : null}
    </View>
    <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
  </Pressable>
}
