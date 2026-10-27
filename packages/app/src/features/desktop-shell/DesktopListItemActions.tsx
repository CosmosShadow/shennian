// @arch docs/design/desktop/macos-interaction-baseline.md
// @test ../../__tests__/list-item-actions-modal.test.ts

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import type { ListItemActionsProps } from '../../components/ListItemActionsModal'
import { useTheme } from '../../hooks/useTheme'
import { useWebModalFocus } from '../../hooks/useWebModalFocus'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { restoreWebModalFocus } from '../../utils/webModalFocus'
import { desktopTypography } from './desktopDesignTokens'
import { desktopListMenuPosition } from './desktopListMenuPosition'
import { DesktopDialog } from './DesktopDialog'

/** Menus and confirmations have separate lifetimes and never stack modal roots. */
export function DesktopListItemActions(props: ListItemActionsProps) {
  const {
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
    anchorRef,
  } = props
  const { colors } = useTheme()
  const { width, height } = useWindowDimensions()
  const [confirming, setConfirming] = useState(mode === 'delete')
  const [position, setPosition] = useState({ left: 8, top: 48 })
  const [menuHeight, setMenuHeight] = useState(128)
  const cardRef = useRef<View>(null)
  const safeActionRef = useRef<View>(null)
  const wasVisibleRef = useRef(false)
  const menuWidth = Math.min(240, width - 16)
  useEscapeKey(visible && !confirming, onClose)
  useWebModalFocus({
    visible: visible && !confirming,
    containerRef: cardRef,
    initialFocusRef: safeActionRef,
    returnFocusRef: anchorRef,
  })

  useEffect(() => {
    if (visible) setConfirming(mode === 'delete')
  }, [mode, visible])
  useEffect(() => {
    const wasVisible = wasVisibleRef.current
    wasVisibleRef.current = visible
    if (visible || !wasVisible) return
    // Restore after the native-web portal's own focus trap has unmounted.
    const frame = requestAnimationFrame(() => restoreWebModalFocus(anchorRef?.current))
    return () => cancelAnimationFrame(frame)
  }, [visible, anchorRef])
  useEffect(() => {
    if (!visible) return
    let active = true
    anchorRef?.current?.measureInWindow((x, y, w, h) => {
      if (!active) return
      setPosition(
        desktopListMenuPosition(
          { x, y, width: w, height: h },
          { width, height },
          { width: menuWidth, height: menuHeight },
        ),
      )
    })
    return () => {
      active = false
    }
  }, [visible, anchorRef, width, height, menuWidth, menuHeight])
  useEffect(() => {
    if (!visible) return
    const frame = requestAnimationFrame(() => safeActionRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [visible, confirming])

  const activate = (action: () => void) => {
    onClose()
    action()
  }
  const navigate = (event: KeyboardEvent<HTMLElement>) => {
    if (confirming) return
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'))
    const current = items.indexOf(document.activeElement as HTMLElement)
    let next: number | null = null
    if (event.key === 'ArrowDown') next = (current + 1) % items.length
    if (event.key === 'ArrowUp') next = (Math.max(0, current) - 1 + items.length) % items.length
    if (event.key === 'Home') next = 0
    if (event.key === 'End') next = items.length - 1
    if (next === null) return
    event.preventDefault()
    event.stopPropagation()
    items[next]?.focus()
  }

  // Remove the portal completely on close so Electron does not retain an
  // inactive modal accessibility root over the underlying workspace.
  if (!visible) return null

  if (confirming) return (
    <DesktopDialog title={deleteConfirmTitle ?? deleteLabel} onClose={onClose} initialFocusRef={safeActionRef}>
      <Text style={[desktopTypography.body, { color: colors.textSecondary }]}>{deleteMessage}</Text>
      <View style={styles.confirmActions}>
        <Action actionRef={safeActionRef} label={cancelLabel} onPress={onClose} />
        <Action label={deleteLabel} destructive onPress={() => activate(onDelete)} />
      </View>
    </DesktopDialog>
  )

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      accessibilityLabel={title}
    >
      <View style={styles.overlay}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
        <View
          ref={cardRef}
          onLayout={(event) => {
            setMenuHeight(event.nativeEvent.layout.height)
          }}
          {...{
            // RN Web Modal already owns dialog / aria-modal semantics.
            // Only the action list needs an additional, non-modal menu role.
            role: 'menu',
            'aria-label': title,
            onKeyDown: navigate,
          }}
          style={[
            styles.card,
            { backgroundColor: colors.bg, borderColor: colors.border },
            { position: 'absolute', width: menuWidth, ...position },
          ]}
        >
          <Text
            style={[
              styles.menuTitle,
              { color: colors.textSecondary },
            ]}
            numberOfLines={2}
          >
            {title}
          </Text>
          {(
            <>
              {pinLabel && onTogglePin ? (
                <Action
                  actionRef={safeActionRef}
                  menu
                  label={pinLabel}
                  onPress={() => activate(onTogglePin)}
                />
              ) : null}
              <Action
                actionRef={pinLabel && onTogglePin ? undefined : safeActionRef}
                menu
                label={deleteLabel}
                destructive
                onPress={() => setConfirming(true)}
              />
            </>
          )}
        </View>
      </View>
    </Modal>
  )
}

function Action({
  label,
  onPress,
  destructive,
  menu,
  actionRef,
}: {
  label: string
  onPress(): void
  destructive?: boolean
  menu?: boolean
  actionRef?: React.RefObject<View | null>
}) {
  const { colors } = useTheme()
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  return (
    <Pressable
      ref={actionRef}
      accessibilityRole={menu ? 'menuitem' : 'button'}
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [
        styles.action,
        !menu && styles.confirmButton,
        {
          borderColor: focused ? colors.brand : 'transparent',
          backgroundColor: hovered || pressed || !menu ? colors.surfaceHover : 'transparent',
        },
      ]}
    >
      <Text
        style={[desktopTypography.control, { color: destructive ? colors.errorText : colors.text }]}
      >
        {label}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  overlay: { flex: 1 },
  card: {
    padding: 6,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    boxShadow: '0 6px 24px rgba(0,0,0,.14)',
  },
  menuTitle: { ...desktopTypography.metadata, paddingHorizontal: 9, paddingVertical: 6 },
  action: {
    minHeight: 32,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderWidth: 1,
    borderRadius: 5,
    justifyContent: 'center',
  },
  confirmButton: { minWidth: 68, minHeight: 36, alignItems: 'center' },
  confirmActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 6 },
})
