// @arch docs/design/desktop/macos-interaction-baseline.md
// @test packages/app/src/__tests__/web-modal-focus.test.ts
import Feather from '@expo/vector-icons/Feather'
import { useRef, type ReactNode, type RefObject } from 'react'
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../hooks/useTheme'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { useWebModalFocus } from '../../hooks/useWebModalFocus'
import { desktopControlMetrics, desktopTypography } from './desktopDesignTokens'

export function DesktopDialog({
  title,
  onClose,
  children,
  initialFocusRef,
  returnFocusRef,
  busy = false,
  suspended = false,
}: {
  title: string
  onClose(): void
  children: ReactNode
  initialFocusRef?: RefObject<View | null>
  returnFocusRef?: RefObject<unknown>
  busy?: boolean
  suspended?: boolean
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const card = useRef<View>(null)
  const close = useRef<View>(null)
  const requestClose = () => {
    if (!busy && !suspended) onClose()
  }
  // Keep consuming Escape while busy; it must not dismiss an underlying layer.
  useEscapeKey(!suspended, requestClose, { includeEditable: true })
  useWebModalFocus({
    visible: true,
    containerRef: card,
    initialFocusRef: initialFocusRef ?? close,
    returnFocusRef,
    suspended,
  })
  // RN Web Modal also closes on keyup. After a child closes on keydown, that
  // keyup reaches the newly active parent. Handle web Escape only once here.
  return (
    <Modal
      transparent
      visible
      animationType="none"
      onRequestClose={Platform.OS === 'web' ? undefined : requestClose}
      accessibilityLabel={title}
    >
      <View style={styles.overlay}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={requestClose}
          accessible={false}
          importantForAccessibility="no-hide-descendants"
        />
        <View
          ref={card}
          role="dialog"
          accessibilityViewIsModal
          style={[styles.card, { backgroundColor: colors.bg, borderColor: colors.border }]}
        >
          <View style={styles.header}>
            <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
              {title}
            </Text>
            {busy ? (
              <Text
                accessibilityLiveRegion="polite"
                style={[desktopTypography.metadata, { color: colors.textSecondary }]}
              >
                {t('desktop_dialog_busy')}
              </Text>
            ) : null}
            <Pressable
              ref={close}
              accessibilityRole="button"
              accessibilityLabel={t('close')}
              onPress={requestClose}
              disabled={busy}
              accessibilityState={{ disabled: busy }}
              accessibilityHint={busy ? t('desktop_dialog_busy') : undefined}
              style={({ pressed }) => [
                styles.close,
                busy && { opacity: 0.4 },
                pressed && !busy && { backgroundColor: colors.surfaceHover },
              ]}
            >
              <Feather name="x" size={18} color={colors.textSecondary} />
            </Pressable>
          </View>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,.18)',
  },
  card: {
    width: desktopControlMetrics.dialogWidth,
    maxWidth: '100%',
    maxHeight: '100%',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    boxShadow: '0 8px 28px rgba(0,0,0,.16)',
    overflow: 'hidden',
  },
  header: {
    minHeight: 48,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: { ...desktopTypography.dialogTitle, flex: 1, minWidth: 0 },
  close: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 6 },
  scroll: { flexGrow: 0, flexShrink: 1, minHeight: 0 },
  content: { padding: 16, paddingTop: 8 },
})
