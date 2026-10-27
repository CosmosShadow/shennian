// @arch docs/architecture/app/chat-attachments-preview.md
// @test packages/app/src/__tests__/file-drawer-actions.test.ts
import { Modal, Pressable, StyleSheet, Switch, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import Feather from '@expo/vector-icons/Feather'
import { useTheme } from '../../hooks/useTheme'

export function FileBrowserMenu({
  visible,
  showHidden,
  onClose,
  onToggleHidden,
  onUpload,
}: {
  onUpload?: () => void
  visible: boolean
  showHidden: boolean
  onClose: () => void
  onToggleHidden: (value: boolean) => void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityLabel={t('close')}
        />
        <View
          accessibilityViewIsModal
          style={[styles.menu, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <View style={styles.heading}>
            <Text style={[styles.title, { color: colors.text }]}>{t('more')}</Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={t('close')}
              style={styles.close}
            >
              <Feather name="x" size={20} color={colors.textSecondary} />
            </Pressable>
          </View>
          {onUpload ? <Pressable style={styles.row} accessibilityRole="button" testID="file-browser-upload"
            accessibilityLabel={t('remote_folder_upload_current')} onPress={() => { onClose(); onUpload() }}>
            <Feather name="upload" size={20} color={colors.textSecondary} />
            <Text style={[styles.label, { color: colors.text }]}>{t('remote_folder_upload_current')}</Text>
          </Pressable> : null}
          <View style={styles.row}>
            <Feather name="eye" size={20} color={colors.textSecondary} />
            <Text style={[styles.label, { color: colors.text }]}>{t('show_hidden_files')}</Text>
            <Switch
              value={showHidden}
              onValueChange={onToggleHidden}
              trackColor={{ true: colors.brand }}
              accessibilityLabel={t('show_hidden_files')}
              testID="file-browser-toggle-hidden"
            />
          </View>
        </View>
      </View>
    </Modal>
  )
}
const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#00000030',
    padding: 24,
  },
  menu: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
  },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  title: { fontSize: 17, fontWeight: '600' },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12 },
  label: { flex: 1, fontSize: 15 },
})
