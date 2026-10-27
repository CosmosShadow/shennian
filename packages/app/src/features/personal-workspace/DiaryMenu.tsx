// @arch docs/features/personal-agent-workspace.md
// @test src/__tests__/diary-screen.test.ts
import { Modal, Pressable, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../hooks/useTheme'
import type { DiaryStatus } from './diaryRuntime'

export function DiaryMenu({ visible, close, status }: { visible: boolean; close: () => void; status: DiaryStatus }) {
  const { t } = useTranslation(), { colors } = useTheme()
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
    <View style={{ flex: 1, justifyContent: 'flex-end' }}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('cancel')} onPress={close} style={{ position: 'absolute', inset: 0, backgroundColor: '#00000055' }} />
      <View accessibilityViewIsModal style={{ backgroundColor: colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40, gap: 20 }}>
        <Text style={{ fontSize: 18, fontWeight: '600', color: colors.text }}>{t('personal_diary_source')}</Text>
        <View style={{ gap: 8 }}>
          <Text style={{ color: colors.text }}>{status.target?.machine?.name ?? t('personal_primary_not_configured')}</Text>
          <Text selectable style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 21 }}>{status.directory ?? t('personal_diary_directory_unknown')}</Text>
        </View>
        <Pressable accessibilityRole="button" onPress={close} style={{ paddingVertical: 12 }}><Text style={{ color: colors.textSecondary }}>{t('cancel')}</Text></Pressable>
      </View>
    </View>
  </Modal>
}
