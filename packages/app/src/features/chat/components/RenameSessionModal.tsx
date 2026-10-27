// @arch docs/architecture/app/modular-features.md#聊天-feature
// @test tests/e2e/mobile/flows/ios/project-session-rename.yaml

import { Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { Colors } from '../../../hooks/useTheme'
import { mobileTypography } from '../../../theme/mobileTypography'
import { useEscapeKey } from '../../../hooks/useEscapeKey'

type Props = {
  visible: boolean
  onClose: () => void
  renameInput: string
  setRenameInput: (value: string) => void
  onConfirm: () => void | Promise<void>
  renameSaving: boolean
  colors: Colors
}

export function RenameSessionModal({
  visible,
  onClose,
  renameInput,
  setRenameInput,
  onConfirm,
  renameSaving,
  colors,
}: Props) {
  const { t } = useTranslation()
  useEscapeKey(visible, onClose)

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.centeredOverlay} onPress={onClose} accessible={false}>
        <Pressable
          style={[styles.renameCard, { backgroundColor: colors.surface }]}
          accessible={false}
          accessibilityViewIsModal
        >
          <Text style={[styles.renameCardTitle, { color: colors.text }]}>
            {t('rename_session')}
          </Text>
          <TextInput
            testID="rename-session-input"
            style={[
              styles.renameInput,
              {
                color: colors.text,
                borderColor: `${colors.brand}70`,
                backgroundColor: colors.bg,
              },
            ]}
            value={renameInput}
            onChangeText={setRenameInput}
            placeholder={t('rename_session_placeholder')}
            placeholderTextColor={colors.textTertiary}
            autoFocus
            selectTextOnFocus
            onSubmitEditing={() => void onConfirm()}
          />
          <View style={styles.renameActions}>
            <Pressable
              testID="rename-session-cancel"
              accessibilityRole="button"
              style={[styles.renameBtn, { backgroundColor: colors.surfaceHover }]}
              onPress={onClose}
            >
              <Text style={[styles.renameBtnText, { color: colors.text }]}>{t('cancel')}</Text>
            </Pressable>
            <Pressable
              testID="rename-session-confirm"
              accessibilityRole="button"
              style={[styles.renameBtn, { backgroundColor: colors.brand }]}
              onPress={() => void onConfirm()}
              disabled={renameSaving}
            >
              <Text style={[styles.renameBtnText, { color: '#fff' }]}>
                {renameSaving ? t('rename_saving') : t('confirm')}
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  centeredOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  renameCard: {
    width: 320,
    borderRadius: 14,
    padding: 24,
    gap: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 8,
  },
  renameCardTitle: {
    fontSize: 16,
    fontWeight: '600',
    ...(Platform.OS !== 'web' && mobileTypography.navigationTitle),
  },
  renameInput: {
    borderWidth: 1.5,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    ...(Platform.OS !== 'web' && mobileTypography.body),
  },
  renameActions: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'flex-end',
  },
  renameBtn: {
    ...(Platform.OS !== 'web' && { minHeight: Platform.OS === 'android' ? 48 : 44, justifyContent: 'center' as const }),
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  renameBtnText: {
    fontSize: 14,
    fontWeight: '500',
    ...(Platform.OS !== 'web' && mobileTypography.body),
  },
})
