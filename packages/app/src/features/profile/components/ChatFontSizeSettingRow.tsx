// @arch docs/features/chat-font-size.md
import { Pressable, Text } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../../hooks/useTheme'
import { useChatFontSize } from '../../../hooks/useChatFontSize'
import { styles } from '../styles'

export function ChatFontSizeSettingRow() {
  const router = useRouter()
  const { t } = useTranslation()
  const { colors } = useTheme()
  const { size } = useChatFontSize()
  return (
    <Pressable style={styles.row} onPress={() => router.navigate('/(main)/chat-font-size')}
      testID="settings-chat-font-size" accessibilityRole="button">
      <Ionicons name="text-outline" size={20} color={colors.textSecondary} />
      <Text style={[styles.rowLabel, { color: colors.text }]}>{t('chat_font_size')}</Text>
      <Text style={[styles.rowValue, { color: colors.textSecondary }]}>{t(`chat_font_${size}`)}</Text>
      <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
    </Pressable>
  )
}
