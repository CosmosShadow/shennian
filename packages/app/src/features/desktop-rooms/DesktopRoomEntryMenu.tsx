// @arch docs/design/desktop/unified-desktop-control.md#群聊工作区本轮推荐方案
// @test ../../__tests__/desktop-room-entry.test.ts

import Ionicons from '@expo/vector-icons/Ionicons'
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../hooks/useTheme'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { useWebModalFocus } from '../../hooks/useWebModalFocus'
import { nextDesktopRoomEntryMenuIndex } from './desktopRoomEntryWorkflow'
import { desktopControlMetrics, desktopTypography } from '../desktop-shell/desktopDesignTokens'

export type DesktopRoomEntryMenuPosition = { top: number; left: number }

export function DesktopRoomEntryMenu({
  visible,
  position,
  triggerRef,
  onClose,
  onCreate,
  onJoin,
}: {
  visible: boolean
  position: DesktopRoomEntryMenuPosition
  triggerRef: RefObject<unknown>
  onClose(): void
  onCreate(): void
  onJoin(): void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const menuRef = useRef<View>(null)
  const firstItemRef = useRef<View>(null)
  useEscapeKey(visible, onClose)
  useWebModalFocus({
    visible,
    containerRef: menuRef,
    initialFocusRef: firstItemRef,
    returnFocusRef: triggerRef,
  })

  useEffect(() => {
    const node = menuRef.current as unknown as HTMLElement | null
    if (!visible || !node || typeof document === 'undefined') return
    const onKeyDown = (event: KeyboardEvent) => {
      const items = Array.from(node.querySelectorAll<HTMLElement>('[role="menuitem"]'))
      if (!items.length) return
      const current = items.indexOf(document.activeElement as HTMLElement)
      const next = nextDesktopRoomEntryMenuIndex(event.key, current, items.length)
      if (next !== null) {
        event.preventDefault()
        event.stopPropagation()
        items[next]?.focus()
      } else if (event.key === 'Enter') {
        event.preventDefault()
        event.stopPropagation()
        items[Math.max(0, current)]?.click()
      }
    }
    node.addEventListener('keydown', onKeyDown)
    return () => node.removeEventListener('keydown', onKeyDown)
  }, [visible])

  const choose = useCallback((action: () => void) => {
    onClose()
    action()
  }, [onClose])

  return <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
    <View style={styles.overlay}>
      <Pressable accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
        style={StyleSheet.absoluteFill} onPress={onClose} />
      <View ref={menuRef} testID="desktop-room-entry-menu" accessibilityRole="menu"
        accessibilityViewIsModal style={[styles.menu, position, {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          shadowColor: colors.text,
        }]}>
        <MenuItem itemRef={firstItemRef} testID="desktop-room-entry-menu-create"
          icon="people-outline" label={t('spaces_create_action')} colors={colors}
          onPress={() => choose(onCreate)} />
        <MenuItem testID="desktop-room-entry-menu-join" icon="link-outline"
          label={t('spaces_enter_link')} colors={colors} onPress={() => choose(onJoin)} />
      </View>
    </View>
  </Modal>
}

function MenuItem({ itemRef, testID, icon, label, colors, onPress }: {
  itemRef?: RefObject<View | null>
  testID: string
  icon: keyof typeof Ionicons.glyphMap
  label: string
  colors: ReturnType<typeof useTheme>['colors']
  onPress(): void
}) {
  const [focused, setFocused] = useState(false)
  const [hovered, setHovered] = useState(false)
  return <Pressable ref={itemRef} testID={testID} accessibilityRole="menuitem"
    accessibilityLabel={label} onPress={onPress} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
    style={({ pressed }) => [styles.item, {
      backgroundColor: pressed || hovered ? colors.surfaceHover : 'transparent',
      borderColor: focused ? colors.brand : 'transparent',
    }]}>
    <Ionicons name={icon} size={17} color={colors.textSecondary} />
    <Text style={[styles.itemText, { color: colors.text }]}>{label}</Text>
  </Pressable>
}

const styles = StyleSheet.create({
  overlay: { flex: 1 },
  menu: {
    position: 'absolute', width: 210, padding: 5, borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10, boxShadow: '0 10px 28px rgba(0,0,0,.16)',
  },
  item: { minHeight: desktopControlMetrics.compactControlHeight, paddingHorizontal: 10, borderWidth: 1, borderRadius: desktopControlMetrics.radiusSmall, flexDirection: 'row', alignItems: 'center', gap: 8 },
  itemText: { ...desktopTypography.control, fontWeight: '400' },
})
