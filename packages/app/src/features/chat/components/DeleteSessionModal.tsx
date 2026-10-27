// @arch docs/architecture/app/modular-features.md#聊天-feature

import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { Colors } from '../../../hooks/useTheme'
import { useEscapeKey } from '../../../hooks/useEscapeKey'

type Props = {
  visible: boolean
  onClose: () => void
  onConfirm: () => void
  colors: Colors
}

export function DeleteSessionModal({ visible, onClose, onConfirm, colors }: Props) {
  const { t } = useTranslation()
  useEscapeKey(visible, onClose)

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.centeredOverlay} onPress={onClose}>
        <Pressable
          style={[
            styles.confirmCard,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.confirmTitle, { color: colors.text }]}>{t('delete_session')}</Text>
          <Text style={[styles.confirmMessage, { color: colors.textSecondary }]}>
            {t('confirm_delete_session')}
          </Text>
          <View style={styles.confirmActions}>
            <Pressable
              style={[styles.confirmBtn, { backgroundColor: colors.surfaceHover }]}
              onPress={onClose}
            >
              <Text style={[styles.confirmBtnText, { color: colors.text }]}>{t('cancel')}</Text>
            </Pressable>
            <Pressable style={[styles.confirmBtn, { backgroundColor: '#ef4444' }]} onPress={onConfirm}>
              <Text style={[styles.confirmBtnText, { color: '#fff' }]}>
                {t('confirm_delete_session_action')}
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
  confirmCard: {
    width: 300,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 20,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 8,
  },
  confirmTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  confirmMessage: {
    fontSize: 14,
    lineHeight: 20,
  },
  confirmActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
    justifyContent: 'flex-end',
  },
  confirmBtn: {
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  confirmBtnText: {
    fontSize: 14,
    fontWeight: '500',
  },
})
