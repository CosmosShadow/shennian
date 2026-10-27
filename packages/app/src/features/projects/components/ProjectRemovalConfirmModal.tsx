// @arch docs/architecture/session-organization.md
// @test src/__tests__/project-launch-entry.test.ts

import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../../hooks/useTheme'

type Props = {
  visible: boolean
  onClose: () => void
  onConfirm: () => void
  titleKey?: string
  messageKey?: string
  confirmKey?: string
  confirming?: boolean
}

export function ProjectRemovalConfirmModal({
  visible,
  onClose,
  onConfirm,
  titleKey = 'remove_project',
  messageKey = 'remove_project_confirm',
  confirmKey = 'remove_project',
  confirming = false,
}: Props) {
  const { t } = useTranslation()
  const { colors } = useTheme()

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('cancel')}
        />
        <View
          style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Text style={[styles.title, { color: colors.text }]}>{t(titleKey)}</Text>
          <Text style={[styles.message, { color: colors.textSecondary }]}>{t(messageKey)}</Text>
          <View style={styles.actions}>
            <Pressable style={styles.button} onPress={onClose} disabled={confirming}>
              <Text style={{ color: colors.textSecondary }}>{t('cancel')}</Text>
            </Pressable>
            <Pressable style={styles.button} onPress={onConfirm} disabled={confirming}>
              {confirming ? (
                <ActivityIndicator size="small" color={colors.error} />
              ) : (
                <Text style={{ color: colors.error, fontWeight: '700' }}>{t(confirmKey)}</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: 'rgba(15, 23, 42, 0.28)',
  },
  backdrop: { ...StyleSheet.absoluteFillObject },
  card: {
    width: 360,
    maxWidth: '100%',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 18,
    gap: 10,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
  },
  message: {
    fontSize: 14,
    lineHeight: 20,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 6,
  },
  button: {
    minHeight: 36,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
