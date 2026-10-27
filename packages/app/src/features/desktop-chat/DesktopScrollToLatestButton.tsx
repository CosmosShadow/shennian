// @arch docs/design/desktop/macos-interaction-baseline.md
import Feather from '@expo/vector-icons/Feather'
import { Pressable, StyleSheet, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { Colors } from '../../hooks/useTheme'

export function DesktopScrollToLatestButton({
  colors,
  onPress,
  testID,
}: {
  colors: Colors
  onPress(): void
  testID?: string
}) {
  const { t } = useTranslation()
  return (
    <View pointerEvents="box-none" style={styles.position}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={t('scroll_to_bottom')}
        onPress={onPress}
        style={({ pressed }) => [
          styles.button,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            opacity: pressed ? 0.75 : 1,
          },
        ]}
      >
        <Feather name="chevron-down" size={18} color={colors.textSecondary} />
      </Pressable>
    </View>
  )
}
const styles = StyleSheet.create({
  position: { position: 'absolute', left: 0, right: 0, bottom: 8, alignItems: 'center' },
  button: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
})
