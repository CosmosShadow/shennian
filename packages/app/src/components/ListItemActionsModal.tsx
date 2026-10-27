// @arch docs/features/agent-workspaces.md
// @arch docs/features/network-rooms/ui.md
// @test src/__tests__/list-item-actions-modal.test.ts

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
  type ComponentProps,
} from 'react'
import {
  ActionSheetIOS,
  Alert,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useTheme } from '../hooks/useTheme'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { useWebModalFocus } from '../hooks/useWebModalFocus'
import { isDesktopControlSurfaceEnabled } from '../utils/controlSurfaceLayout'
import { DesktopListItemActions } from '../features/desktop-shell/DesktopListItemActions'

export type ListItemActionsMode = 'actions' | 'delete'

export type ListItemActionsProps = ComponentProps<typeof LegacyListItemActionsModal> & {
  anchorRef?: RefObject<View | null>
}

export function ListItemActionsModal(props: ListItemActionsProps) {
  if (Platform.OS === 'web' && isDesktopControlSurfaceEnabled()) {
    return <DesktopListItemActions {...props} />
  }
  return <LegacyListItemActionsModal {...props} />
}

function LegacyListItemActionsModal({
  visible,
  mode,
  title,
  pinLabel,
  deleteLabel,
  deleteConfirmTitle,
  deleteMessage,
  cancelLabel,
  onClose,
  onTogglePin,
  onDelete,
}: {
  visible: boolean
  mode: ListItemActionsMode
  title: string
  pinLabel?: string
  deleteLabel: string
  deleteConfirmTitle?: string
  deleteMessage: string
  cancelLabel: string
  onClose: () => void
  onTogglePin?: () => void
  onDelete: () => void
}) {
  const { colors } = useTheme()
  const [currentMode, setCurrentMode] = useState(mode)
  const nativePresentationKey = useRef<string | null>(null)
  const cardRef = useRef<View>(null)
  const cancelButtonRef = useRef<View>(null)
  useEscapeKey(Platform.OS === 'web' && visible, onClose)
  useWebModalFocus({
    visible: Platform.OS === 'web' && visible,
    containerRef: cardRef,
    initialFocusRef: cancelButtonRef,
  })
  useEffect(() => {
    if (visible) setCurrentMode(mode)
  }, [mode, visible])

  const run = useCallback(
    (action: () => void) => {
      onClose()
      action()
    },
    [onClose],
  )

  const confirmDelete = useCallback(() => {
    Alert.alert(
      deleteConfirmTitle ?? deleteLabel,
      deleteMessage,
      [
        { text: cancelLabel, style: 'cancel', onPress: onClose },
        { text: deleteLabel, style: 'destructive', onPress: () => run(onDelete) },
      ],
      { cancelable: true, onDismiss: onClose },
    )
  }, [cancelLabel, deleteConfirmTitle, deleteLabel, deleteMessage, onClose, onDelete, run])

  useEffect(() => {
    if (Platform.OS === 'web') return
    if (!visible) {
      nativePresentationKey.current = null
      return
    }
    const key = `${mode}:${title}`
    if (nativePresentationKey.current === key) return
    nativePresentationKey.current = key
    if (mode === 'delete') {
      confirmDelete()
      return
    }
    if (Platform.OS === 'ios') {
      const options = [...(pinLabel && onTogglePin ? [pinLabel] : []), deleteLabel, cancelLabel]
      const deleteIndex = options.length - 2
      const cancelIndex = options.length - 1
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title,
          options,
          destructiveButtonIndex: deleteIndex,
          cancelButtonIndex: cancelIndex,
        },
        (selectedIndex) => {
          if (selectedIndex === cancelIndex) return onClose()
          if (selectedIndex === deleteIndex) return confirmDelete()
          if (pinLabel && onTogglePin && selectedIndex === 0) run(onTogglePin)
        },
      )
      return
    }
    Alert.alert(
      title,
      undefined,
      [
        ...(pinLabel && onTogglePin ? [{ text: pinLabel, onPress: () => run(onTogglePin) }] : []),
        { text: deleteLabel, style: 'destructive', onPress: confirmDelete },
        { text: cancelLabel, style: 'cancel', onPress: onClose },
      ],
      { cancelable: true, onDismiss: onClose },
    )
  }, [
    cancelLabel,
    deleteLabel,
    confirmDelete,
    mode,
    onClose,
    onTogglePin,
    pinLabel,
    run,
    title,
    visible,
  ])

  if (Platform.OS !== 'web') return null

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View testID="list-item-actions-overlay" style={styles.overlay}>
        <Pressable
          testID="list-item-actions-backdrop"
          style={styles.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={cancelLabel}
        />
        <View
          ref={cardRef}
          testID="list-item-actions-card"
          accessibilityViewIsModal
          style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>
            {currentMode === 'delete' ? (deleteConfirmTitle ?? deleteLabel) : title}
          </Text>
          {currentMode === 'delete' ? (
            <>
              <Text style={[styles.message, { color: colors.textSecondary }]}>{deleteMessage}</Text>
              <View style={[styles.confirmActions, { borderTopColor: colors.border }]}>
                <ModalAction
                  actionRef={cancelButtonRef}
                  label={cancelLabel}
                  color={colors.textSecondary}
                  onPress={onClose}
                  compact
                />
                <View style={[styles.confirmDivider, { backgroundColor: colors.border }]} />
                <ModalAction
                  testID="list-item-delete-confirm"
                  label={deleteLabel}
                  color={colors.error}
                  onPress={() => run(onDelete)}
                  compact
                />
              </View>
            </>
          ) : (
            <>
              {pinLabel && onTogglePin ? (
                <ModalAction
                  label={pinLabel}
                  color={colors.text}
                  onPress={() => run(onTogglePin)}
                />
              ) : null}
              <ModalAction
                label={deleteLabel}
                color={colors.error}
                onPress={() => setCurrentMode('delete')}
              />
            </>
          )}
          {currentMode !== 'delete' ? (
            <ModalAction
              actionRef={cancelButtonRef}
              label={cancelLabel}
              color={colors.textSecondary}
              onPress={onClose}
            />
          ) : null}
        </View>
      </View>
    </Modal>
  )
}

function ModalAction({
  actionRef,
  testID,
  label,
  color,
  onPress,
  compact = false,
}: {
  actionRef?: RefObject<View | null>
  testID?: string
  label: string
  color: string
  onPress: () => void
  compact?: boolean
}) {
  return (
    <Pressable
      ref={actionRef}
      testID={testID}
      accessibilityRole="button"
      style={[styles.action, compact && styles.compactAction]}
      onPress={onPress}
    >
      <Text style={[styles.actionText, { color }]}>{label}</Text>
    </Pressable>
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
    borderRadius: 18,
    padding: 18,
    gap: 6,
  },
  title: { fontSize: 17, lineHeight: 23, fontWeight: '700', textAlign: 'center' },
  message: { fontSize: 14, lineHeight: 20, marginVertical: 6, textAlign: 'center' },
  confirmActions: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 8,
  },
  confirmDivider: { width: StyleSheet.hairlineWidth },
  action: { minHeight: 46, alignItems: 'center', justifyContent: 'center' },
  compactAction: { flex: 1 },
  actionText: { fontSize: 15, lineHeight: 21, fontWeight: '600' },
})
