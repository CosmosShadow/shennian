// @arch docs/features/chat-font-size.md
// @test src/__tests__/chat-font-size.test.ts
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import Ionicons from '@expo/vector-icons/Ionicons'
import { AppPageHeader } from '../../components/AppPageHeader'
import { useTheme } from '../../hooks/useTheme'
import { mobileTypography } from '../../theme/mobileTypography'
import { useChatFontSize } from '../../hooks/useChatFontSize'
import { chatFontSizes } from '../chat/preferences/chatFontSize'

export default function ChatFontSizeScreen() {
  const router = useRouter()
  const { t } = useTranslation()
  const { colors } = useTheme()
  const { size, typography, setSize, saveFailed } = useChatFontSize()
  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
      <AppPageHeader title={t('chat_font_size')} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.preview} testID="chat-font-preview">
          <Text style={[styles.event, typography.system, { color: colors.textSecondary }]}>{t('chat_font_preview_event')}</Text>
          <View style={[styles.bubble, styles.own, { backgroundColor: colors.ownMessage }]}>
            <Text style={[typography.body, { color: colors.text }]}>{t('chat_font_preview_question')}</Text>
          </View>
          <Text style={[typography.author, { color: colors.textSecondary }]}>{t('chat_font_preview_author')}</Text>
          <View style={[styles.bubble, { backgroundColor: colors.surfaceHover }]}>
            <Text style={[typography.body, { color: colors.text }]}>{t('chat_font_preview_answer')}</Text>
          </View>
        </View>
        {chatFontSizes.map((option) => (
          <Pressable key={option} testID={`chat-font-${option}`} accessibilityRole="radio"
            accessibilityState={{ checked: size === option }} onPress={() => void setSize(option)}
            style={[styles.option, { borderBottomColor: colors.border }]}>
            <Text style={[styles.label, { color: colors.text }]}>{t(`chat_font_${option}`)}</Text>
            {size === option ? <Ionicons name="checkmark" size={22} color={colors.brand} /> : null}
          </Pressable>
        ))}
        <Text style={[styles.hint, { color: colors.textSecondary }]}>{t('chat_font_scope')}</Text>
        {saveFailed ? <Text accessibilityRole="alert" style={[styles.hint, { color: colors.error }]}>{t('chat_font_save_failed')}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  )
}
const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 16, paddingBottom: 32, maxWidth: 640, width: '100%', alignSelf: 'center' },
  preview: { gap: 12, paddingVertical: 24 },
  event: { textAlign: 'center', marginBottom: 8 },
  bubble: { padding: 12, borderRadius: 16, maxWidth: '92%', alignSelf: 'flex-start' },
  own: { alignSelf: 'flex-end' },
  option: { minHeight: 52, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, gap: 16 },
  label: { flex: 1, ...mobileTypography.body },
  hint: { ...mobileTypography.metadata, marginTop: 16 },
})
