// @arch docs/features/network-rooms/ui.md#七群聊详情
// @test src/__tests__/room-management-panel.test.ts

import { useRef, useState } from 'react'
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../../hooks/useTheme'
import { useEscapeKey } from '../../../hooks/useEscapeKey'
import { useWebModalFocus } from '../../../hooks/useWebModalFocus'
import { roomAccountClient } from '../roomAccountClient'
import type { RoomDetailView } from '../types'
import { mobileTypography } from '../../../theme/mobileTypography'

export function RoomRenameModal({
  roomId,
  name,
  onClose,
  onSaved,
}: {
  roomId: string
  name: string
  onClose: () => void
  onSaved: (room: RoomDetailView) => void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const [draft, setDraft] = useState(name)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const pending = useRef(false)
  const cardRef = useRef<View>(null)
  const inputRef = useRef<TextInput>(null)
  const close = () => {
    if (!pending.current) onClose()
  }
  useEscapeKey(true, close)
  useWebModalFocus({ visible: true, containerRef: cardRef, initialFocusRef: inputRef })

  const confirm = async () => {
    const next = draft.trim()
    if (!next || pending.current) return
    if (next === name) return onClose()
    pending.current = true
    setSaving(true)
    setFailed(false)
    try {
      const updated = await roomAccountClient.updateRoom(roomId, { name: next })
      onSaved(updated)
      onClose()
    } catch {
      setFailed(true)
    } finally {
      pending.current = false
      setSaving(false)
    }
  }
  const disabled = saving || !draft.trim()

  return (
    <Modal visible transparent animationType="fade" onRequestClose={close}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <View
            ref={cardRef}
            style={[styles.card, { backgroundColor: colors.surface }]}
            accessibilityViewIsModal
          >
            <Text style={[styles.title, { color: colors.text }]}>{t('spaces_settings_name')}</Text>
            <TextInput
              ref={inputRef}
              testID="room-rename-input"
              accessibilityLabel={t('spaces_settings_name')}
              autoFocus
              selectTextOnFocus
              maxLength={80}
              value={draft}
              editable={!saving}
              onChangeText={setDraft}
              style={[
                styles.input,
                { color: colors.text, backgroundColor: colors.bg, borderColor: colors.brand },
              ]}
            />
            {failed ? (
              <Text accessibilityRole="alert" style={{ color: colors.error }}>
                {t('spaces_rename_failed')}
              </Text>
            ) : null}
            <View style={styles.actions}>
              <Pressable
                testID="room-rename-cancel"
                accessibilityRole="button"
                disabled={saving}
                accessibilityState={{ disabled: saving }}
                onPress={close}
                style={styles.button}
              >
                <Text style={[styles.buttonText, { color: colors.textSecondary }]}>
                  {t('cancel')}
                </Text>
              </Pressable>
              <Pressable
                testID="room-rename-confirm"
                accessibilityRole="button"
                disabled={disabled}
                accessibilityState={{ disabled, busy: saving }}
                onPress={() => void confirm()}
                style={[
                  styles.button,
                  { backgroundColor: colors.brand, opacity: disabled ? 0.45 : 1 },
                ]}
              >
                <Text style={[styles.buttonText, styles.confirmText]}>
                  {saving ? t('rename_saving') : t('confirm')}
                </Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  container: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 360, borderRadius: 16, padding: 24, gap: 16 },
  title: { fontSize: 17, lineHeight: 22, fontWeight: '600', ...(Platform.OS !== 'web' && mobileTypography.navigationTitle) },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, fontSize: 15, ...(Platform.OS !== 'web' && mobileTypography.body) },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12 },
  button: {
    minHeight: 44,
    minWidth: 80,
    borderRadius: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontSize: 15, fontWeight: '600', ...(Platform.OS !== 'web' && mobileTypography.compactAction) },
  confirmText: { color: '#fff' },
})
