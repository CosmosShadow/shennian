// @arch docs/design/desktop/macos-interaction-baseline.md#群聊分屏
// @test ../../__tests__/desktop-room-agent-participation.test.ts

import { useRef, type RefObject } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../hooks/useTheme'
import { useWebModalFocus } from '../../hooks/useWebModalFocus'
import { focusWebModal, type FocusContainer } from '../../utils/webModalFocus'
import { AgentParticipationMutationBoundary } from '../rooms/AgentParticipationMutationBoundary'
import { desktopControlMetrics, desktopTypography } from '../desktop-shell/desktopDesignTokens'
import { DesktopRoomAgentParticipation } from './DesktopRoomAgentParticipation'

export function DesktopRoomAgentDetailsDialog({
  roomId,
  agentIdentityId,
  visible,
  onClose,
  onOpenWork,
  returnFocusRef,
}: {
  roomId: string
  agentIdentityId: string
  visible: boolean
  onClose(): void
  onOpenWork?(): void
  returnFocusRef?: RefObject<unknown>
}) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const router = useRouter()
  const { width, height } = useWindowDimensions()
  const dialogRef = useRef<View>(null)
  useWebModalFocus({ visible, containerRef: dialogRef, returnFocusRef })

  if (!visible) return null
  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}
      accessibilityLabel={t('agents_detail_title')}
      onShow={() => focusWebModal(dialogRef.current as unknown as FocusContainer | null)}>
      <View accessibilityViewIsModal style={styles.overlay}>
        <Pressable accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
          style={styles.backdrop} onPress={onClose} />
        <View ref={dialogRef} testID="desktop-room-agent-details-dialog" style={[
          styles.dialog,
          {
            width: Math.min(520, Math.max(320, width - 48)),
            height: Math.min(680, Math.max(420, height - 48)),
            backgroundColor: colors.groupedBackground,
            borderColor: colors.border,
            shadowColor: colors.text,
          },
        ]}>
          <View style={[styles.header, { backgroundColor: colors.bg }]}>
            <View style={styles.headerCopy}>
              <Text accessibilityRole="header" numberOfLines={1}
                style={[styles.title, { color: colors.text }]}>{t('agents_detail_title')}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={t('close')}
              style={styles.iconButton} onPress={onClose}>
              <Ionicons name="close" size={20} color={colors.textSecondary} />
            </Pressable>
          </View>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
            <AgentParticipationMutationBoundary>
              <DesktopRoomAgentParticipation roomId={roomId} agentIdentityId={agentIdentityId}
                onOpenWork={sessionId => {
                  onClose()
                  onOpenWork?.()
                  router.navigate({ pathname: '/(main)/chat/[sessionId]', params: { sessionId } })
                }}
                onRemoved={onClose} />
            </AgentParticipationMutationBoundary>
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: 'rgba(0,0,0,0.24)' },
  backdrop: { ...StyleSheet.absoluteFillObject },
  dialog: { maxWidth: '100%', maxHeight: '100%', overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, boxShadow: '0 8px 28px rgba(0,0,0,.16)' },
  header: { minHeight: 76, paddingVertical: 16, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center' },
  headerCopy: { flex: 1, minWidth: 0, paddingLeft: 6 },
  title: desktopTypography.dialogTitle,
  iconButton: { width: desktopControlMetrics.iconButtonSize, height: desktopControlMetrics.iconButtonSize, alignItems: 'center', justifyContent: 'center' },
  scroll: { flex: 1 },
  content: { width: '100%', padding: 20, paddingTop: 4, paddingBottom: 24 },
})
