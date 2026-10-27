// @arch docs/design/desktop/unified-desktop-control.md#设置页面
// @test ../../../__tests__/desktop-settings-surface.test.ts

import { useRef } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../../hooks/useTheme'
import { useWebModalFocus } from '../../../hooks/useWebModalFocus'

export function DesktopSettingsLeaveDialog({
  visible,
  saving,
  onSave,
  onDiscard,
  onContinue,
}: {
  visible: boolean
  saving: boolean
  onSave: () => void
  onDiscard: () => void
  onContinue: () => void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const continueRef = useRef<View>(null)
  const dialogRef = useRef<View>(null)

  useWebModalFocus({ visible, containerRef: dialogRef, initialFocusRef: continueRef })

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onContinue}>
      <View
        accessibilityViewIsModal
        style={dialogStyles.overlay}
        testID="desktop-settings-leave-dialog"
      >
        <View
          ref={dialogRef}
          style={[dialogStyles.card, { backgroundColor: colors.bg, borderColor: colors.border }]}
        >
          <Text accessibilityRole="header" style={[dialogStyles.title, { color: colors.text }]}>
            {t('desktop_settings_unsaved_title')}
          </Text>
          <Text style={[dialogStyles.message, { color: colors.textSecondary }]}>
            {t('desktop_settings_unsaved_message')}
          </Text>
          <View style={dialogStyles.actions}>
            <Pressable
              ref={continueRef}
              accessibilityRole="button"
              disabled={saving}
              onPress={onContinue}
              style={[dialogStyles.button, { backgroundColor: colors.surfaceHover }]}
              testID="desktop-settings-continue-editing"
            >
              <Text style={[dialogStyles.buttonText, { color: colors.text }]}>
                {t('desktop_settings_continue_editing')}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={saving}
              onPress={onDiscard}
              style={[dialogStyles.button, { backgroundColor: colors.surfaceHover }]}
              testID="desktop-settings-discard"
            >
              <Text style={[dialogStyles.buttonText, { color: colors.error }]}>
                {t('desktop_settings_discard_changes')}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ busy: saving, disabled: saving }}
              disabled={saving}
              onPress={onSave}
              style={[dialogStyles.button, { backgroundColor: colors.brand }]}
              testID="desktop-settings-save-and-leave"
            >
              <Text style={[dialogStyles.buttonText, dialogStyles.primaryText]}>
                {t('desktop_settings_save_changes')}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  )
}

const dialogStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: 'rgba(0, 0, 0, 0.28)',
  },
  card: {
    width: '100%',
    maxWidth: 440,
    maxHeight: '100%',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 24,
    gap: 12,
  },
  title: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  message: { fontSize: 15, lineHeight: 22 },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap-reverse',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 8,
  },
  button: {
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  buttonText: { fontSize: 15, lineHeight: 22, fontWeight: '600' },
  primaryText: { color: '#fff' },
})
