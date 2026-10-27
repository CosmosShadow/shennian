import { ActionIcon } from '../../../components/ActionIcon'
// @arch docs/features/machine-onboarding.md
import { Pressable, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../../hooks/useTheme'
import { mobileTypography } from '../../../theme/mobileTypography'

// Empty states retain one destination; installation details belong to full pages.
export function FirstMachineSetupPanel(_props: {
  onMachineAdded?: () => void
  onMachineInvite?: (token: string) => void
  onScan?: () => void
  showHeading?: boolean
}) {
  const router = useRouter()
  const { colors } = useTheme()
  const { t } = useTranslation()
  return (
    <View style={{ width: '100%', gap: 12 }}>
      <Text style={{ ...mobileTypography.secondary, color: colors.textSecondary }}>
        {t('setup_own_computer_hint')}
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => router.navigate('/(main)/add-machine')}
        style={{ minHeight: 48, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12 }}
      >
        <ActionIcon name="add" color={colors.brand} />
        <Text style={{ ...mobileTypography.body, color: colors.brand, flex: 1 }}>
          {t('add_machine')}
        </Text>
        <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
      </Pressable>
    </View>
  )
}
