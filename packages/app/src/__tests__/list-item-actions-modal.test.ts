// @covers packages/app/src/components/ListItemActionsModal.tsx

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { desktopListMenuPosition } from '../features/desktop-shell/desktopListMenuPosition'

describe('List item actions modal', () => {
  it('anchors desktop actions below the trigger and flips above at the bottom edge', () => {
    const viewport = { width: 1200, height: 800 }
    const menu = { width: 240, height: 128 }
    expect(desktopListMenuPosition({ x: 230, y: 200, width: 32, height: 24 }, viewport, menu))
      .toEqual({ left: 22, top: 228 })
    expect(desktopListMenuPosition({ x: 1170, y: 760, width: 32, height: 24 }, viewport, menu))
      .toEqual({ left: 952, top: 628 })
    expect(desktopListMenuPosition({ x: 0, y: 0, width: 20, height: 24 }, viewport, menu).left).toBe(8)
  })
  it('uses native mobile actions and keeps a focused web dialog fallback', () => {
    const source = readFileSync(
      resolve(__dirname, '../components/ListItemActionsModal.tsx'),
      'utf8',
    )
    expect(source).toContain("if (Platform.OS !== 'web') return null")
    expect(source).toContain('ActionSheetIOS.showActionSheetWithOptions(')
    expect(source).toContain('Alert.alert(')
    expect(source).toContain("style: 'destructive'")
    expect(source).toContain("style: 'cancel'")
    expect(source).toContain('<Modal visible={visible}')
    expect(source).toContain("setCurrentMode('delete')")
    expect(source).toContain('testID="list-item-delete-confirm"')
    expect(source).toContain('run(onDelete)')
    expect(source).toContain('deleteConfirmTitle ?? deleteLabel')
    expect(source).toContain('styles.confirmActions')
    expect(source).toContain("currentMode !== 'delete'")
    expect(source).toContain("useEscapeKey(Platform.OS === 'web' && visible, onClose)")
    expect(source).toContain('containerRef: cardRef')
    expect(source).toContain('initialFocusRef: cancelButtonRef')
  })

  it('keeps Desktop Agent and Room row actions keyboard-discoverable', () => {
    const agents = readFileSync(resolve(__dirname, '../features/desktop-agents/DesktopAgentsScreen.tsx'), 'utf8')
    const rooms = readFileSync(
      resolve(__dirname, '../features/rooms/components/RoomListPanel.tsx'),
      'utf8',
    )

    expect(agents).toContain('accessibilityLabel={`${t(\'more\')} · ${agent.displayName}`}')
    expect(agents).toContain('styles.moreButton')
    expect(agents).toContain("setMode('actions')")
    expect(rooms).toContain('onTogglePin={() => void togglePin(entry.row)}')
    expect(rooms).toContain('...(compact ? contextMenu.bindings : {})')
    expect(rooms).toContain('onSelect: onTogglePin')
  })
})
