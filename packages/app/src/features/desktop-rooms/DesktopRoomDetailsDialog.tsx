// @arch docs/design/desktop/macos-interaction-baseline.md#群聊分屏
// @test ../../__tests__/desktop-room-management.test.ts

import { useEffect, useRef, useState, type RefObject } from 'react'
import { Modal, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native'
import { useTheme } from '../../hooks/useTheme'
import { useTranslation } from 'react-i18next'
import { useWebModalFocus } from '../../hooks/useWebModalFocus'
import { focusWebModal, type FocusContainer } from '../../utils/webModalFocus'
import {
  DesktopRoomManagementPanel,
  type DesktopRoomManagementPage,
} from './DesktopRoomManagementScreen'

export type DesktopRoomDetailsDialogProps = {
  roomId: string
  visible: boolean
  onClose(): void
  returnFocusRef?: RefObject<unknown>
}

export function DesktopRoomDetailsDialog({
  roomId,
  visible,
  onClose,
  returnFocusRef,
}: DesktopRoomDetailsDialogProps) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const { width, height } = useWindowDimensions()
  const dialogRef = useRef<View>(null)
  const [page, setPage] = useState<DesktopRoomManagementPage>('overview')
  const previousPage = useRef<DesktopRoomManagementPage>('overview')
  const [nestedDialogVisible, setNestedDialogVisible] = useState(false)

  useEffect(() => {
    setPage('overview')
    setNestedDialogVisible(false)
  }, [roomId, visible])

  const closeOrBack = () => {
    if (page === 'overview') onClose()
    else setPage('overview')
  }
  const requestClose = () => {
    if (!nestedDialogVisible) closeOrBack()
  }
  const dismiss = () => {
    if (!nestedDialogVisible) onClose()
  }
  useWebModalFocus({ visible, containerRef: dialogRef, returnFocusRef, suspended: nestedDialogVisible })
  useEffect(() => {
    if (!visible) { previousPage.current = 'overview'; return }
    if (Platform.OS !== 'web') return
    const from = previousPage.current
    previousPage.current = page
    const frame = requestAnimationFrame(() => {
      const returnTarget = page === 'overview' && from !== 'overview'
        ? (dialogRef.current as unknown as HTMLElement | null)?.querySelector<HTMLElement>(`[data-testid="desktop-room-details-${from}"]`)
        : null
      focusWebModal(dialogRef.current as unknown as FocusContainer | null, returnTarget)
    })
    return () => cancelAnimationFrame(frame)
  }, [page, visible])

  if (!visible) return null

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={requestClose}
      accessibilityLabel={t('spaces_details_accessibility')}
      onShow={() => focusWebModal(dialogRef.current as unknown as FocusContainer | null)}>
      <View accessibilityViewIsModal style={styles.overlay}>
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.backdrop}
          onPress={dismiss}
        />
        <View
          ref={dialogRef}
          testID="desktop-room-details-dialog"
          style={[
            styles.dialog,
            {
              width: Math.min(520, Math.max(320, width - 48)),
              height: Math.min(page === 'overview' ? 620 : page === 'invite' ? 680 : 560, Math.max(360, height - (page === 'invite' ? 24 : 48))),
              backgroundColor: colors.bg,
              borderColor: colors.border,
              shadowColor: colors.text,
            },
          ]}
        >
          <DesktopRoomManagementPanel
            roomId={roomId}
            page={page}
            onNavigate={setPage}
            onBack={closeOrBack}
            onUnavailableBack={onClose}
            onExitRoom={onClose}
            onClose={onClose}
            showBack={page !== 'overview'}
            onNestedDialogChange={setNestedDialogVisible}
          />
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
    backgroundColor: 'rgba(0,0,0,0.24)',
  },
  backdrop: { ...StyleSheet.absoluteFillObject },
  dialog: {
    maxWidth: '100%',
    maxHeight: '100%',
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    boxShadow: '0 8px 28px rgba(0,0,0,.16)',
  },
})
