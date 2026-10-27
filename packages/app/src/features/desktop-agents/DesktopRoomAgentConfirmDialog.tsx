// @arch docs/design/desktop/unified-desktop-control.md#desktop-实现边界
// @test ../../__tests__/desktop-room-agent-confirmation.test.ts

import { useRef, type RefObject } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../../hooks/useTheme'
import { DesktopDialog } from '../desktop-shell/DesktopDialog'
import { DesktopMachineAction } from '../desktop-machines/DesktopMachineAction'
import { desktopTypography } from '../desktop-shell/desktopDesignTokens'

export function DesktopRoomAgentConfirmDialog({
  visible,
  title,
  body,
  confirmLabel,
  cancelLabel,
  destructive,
  returnFocusRef,
  onCancel,
  onConfirm,
}: {
  visible: boolean
  title: string
  body?: string
  confirmLabel: string
  cancelLabel: string
  destructive: boolean
  returnFocusRef: RefObject<unknown>
  onCancel(): void
  onConfirm(): void
}) {
  const { colors } = useTheme()
  const cancelRef = useRef<View>(null)
  if (!visible) return null

  return (
    <DesktopDialog
      title={title}
      onClose={onCancel}
      initialFocusRef={cancelRef}
      returnFocusRef={returnFocusRef}
    >
      <View
        testID="desktop-room-agent-confirm-dialog"
        accessibilityRole="alert"
        style={styles.content}
      >
        {body ? (
          <Text style={[desktopTypography.body, { color: colors.textSecondary }]}>{body}</Text>
        ) : null}
        <View style={styles.actions}>
          <DesktopMachineAction
            actionRef={cancelRef}
            compact
            label={cancelLabel}
            onPress={onCancel}
          />
          <DesktopMachineAction
            compact
            primary={!destructive}
            destructive={destructive}
            label={confirmLabel}
            onPress={onConfirm}
          />
        </View>
      </View>
    </DesktopDialog>
  )
}

const styles = StyleSheet.create({
  content: { gap: 8 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 10 },
})
