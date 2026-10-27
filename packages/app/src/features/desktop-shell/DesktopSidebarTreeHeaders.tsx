// @arch docs/architecture/session-organization.md
// @arch docs/features/desktop-local-first-client.md#84-desktop-信息架构
// @test src/__tests__/desktop-sidebar-virtualization.test.ts

import Ionicons from '@expo/vector-icons/Ionicons'
import type { SessionProject } from '@shennian/shared'
import { getProjectDisplayName } from '@shennian/shared'
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type GestureResponderEvent,
  type ViewStyle,
} from 'react-native'
import { useTheme } from '../../hooks/useTheme'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { useWebModalFocus } from '../../hooks/useWebModalFocus'
import { ProjectRemovalConfirmModal } from '../projects/components/ProjectRemovalConfirmModal'
import { getPinnedSurfaceColor } from '../session-list/pinnedPalette'
import { UnreadCountBadge } from '../unread/UnreadCountBadge'
import { desktopControlMetrics, desktopTypography } from './desktopDesignTokens'
import { isMacDesktopChrome } from './desktopWindowChrome'

const PROJECT_MENU_WIDTH = 280
const PROJECT_TOOLTIP_EDGE_GAP = 8
const desktopDragRegionStyle: ViewStyle & { WebkitAppRegion?: 'drag' } =
  Platform.OS === 'web' ? { WebkitAppRegion: 'drag' } : {}
const desktopNoDragRegionStyle: ViewStyle & { WebkitAppRegion?: 'no-drag' } =
  Platform.OS === 'web' ? { WebkitAppRegion: 'no-drag' } : {}

export type TooltipPosition = { top: number; left?: number; right?: number }

/**
 * macOS uses a hidden-inset title bar, so the sidebar reserves the traffic-light
 * row as a drag region. Windows keeps its native frame and menu bar; an extra
 * empty row below them would only waste space.
 */
export function DesktopSidebarChrome() {
  if (!isMacDesktopChrome()) return null
  return <View testID="desktop-sidebar-chrome" style={[styles.chrome, desktopDragRegionStyle]} />
}

export type SidebarSectionAction = {
  label: string
  onPress: () => void
  buttonRef?: RefObject<View | null>
}

export function SidebarSectionHeader({
  label,
  expanded,
  onToggle,
  testID,
  action,
  unreadCount = 0,
}: {
  label: string
  expanded: boolean
  onToggle: () => void
  testID: string
  action?: SidebarSectionAction
  /** Total shown next to the label only while folded, so hidden rows never hide new activity. */
  unreadCount?: number
}) {
  const { colors } = useTheme()
  const [headerHovered, setHeaderHovered] = useState(false)
  const [headerFocused, setHeaderFocused] = useState(false)
  const [actionHovered, setActionHovered] = useState(false)
  const [actionFocused, setActionFocused] = useState(false)
  return (
    <View testID={testID} style={styles.sectionHeader}>
      <Pressable
        testID={`${testID}-toggle`}
        style={[
          styles.sectionHeaderLabelButton,
          {
            borderColor: headerFocused ? colors.brand : 'transparent',
            backgroundColor: headerHovered ? colors.surfaceHover : 'transparent',
          },
        ]}
        onPress={onToggle}
        onHoverIn={() => setHeaderHovered(true)}
        onHoverOut={() => setHeaderHovered(false)}
        onFocus={() => setHeaderFocused(true)}
        onBlur={() => setHeaderFocused(false)}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded }}
      >
        <Text style={[styles.sectionHeaderLabel, { color: colors.textSecondary }]}>{label}</Text>
        {/* Always visible: a folded group must read as openable without hovering it. */}
        <View testID={`${testID}-chevron`} pointerEvents="none">
          <Ionicons
            name={expanded ? 'chevron-down' : 'chevron-forward'}
            size={14}
            color={expanded ? colors.textTertiary : colors.textSecondary}
          />
        </View>
        {unreadCount > 0 ? (
          <UnreadCountBadge testID={`${testID}-unread`} count={unreadCount} />
        ) : null}
      </Pressable>
      {action ? (
        <Pressable
          ref={action.buttonRef}
          testID={`${testID}-action`}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          {...{ title: action.label }}
          onPress={action.onPress}
          onHoverIn={() => setActionHovered(true)}
          onHoverOut={() => setActionHovered(false)}
          onFocus={(event) =>
            setActionFocused(
              (event.nativeEvent.target as unknown as HTMLElement)?.matches?.(':focus-visible') ??
                false,
            )
          }
          onBlur={() => setActionFocused(false)}
          style={[
            styles.sectionHeaderAction,
            {
              backgroundColor: actionHovered ? colors.surfaceHover : 'transparent',
              borderColor: actionFocused ? colors.brand : 'transparent',
            },
            desktopNoDragRegionStyle,
          ]}
        >
          <Ionicons
            name="add"
            size={desktopControlMetrics.iconGlyphSize}
            color={colors.textSecondary}
          />
        </Pressable>
      ) : null}
    </View>
  )
}

export function SidebarProjectHeader({
  project,
  active: _active,
  offline,
  pinned,
  expanded,
  showMachineName,
  onToggleExpanded,
  onCreateSession,
  onTogglePin,
  onRemove,
  onShowLaunchTooltip,
  onHideLaunchTooltip,
  unreadCount,
}: {
  project: SessionProject
  active: boolean
  offline: boolean
  pinned: boolean
  expanded: boolean
  showMachineName: boolean
  onToggleExpanded: () => void
  onCreateSession: () => void
  onTogglePin: () => void
  onRemove?: () => void
  onShowLaunchTooltip: (position: TooltipPosition) => void
  onHideLaunchTooltip: () => void
  unreadCount: number
}) {
  const { t } = useTranslation()
  const { colors, isDark } = useTheme()
  const { width } = useWindowDimensions()
  const canShowTooltip = Platform.OS === 'web' && width >= 768
  const [hovered, setHovered] = useState(false)
  const [pressed, setPressed] = useState(false)
  const [primaryFocused, setPrimaryFocused] = useState(false)
  const [menuVisible, setMenuVisible] = useState(false)
  const [removeConfirmVisible, setRemoveConfirmVisible] = useState(false)
  const [menuBtnHovered, setMenuBtnHovered] = useState(false)
  const [menuBtnFocused, setMenuBtnFocused] = useState(false)
  const [launchHovered, setLaunchHovered] = useState(false)
  const [launchFocused, setLaunchFocused] = useState(false)
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 })
  const menuAnchorRef = useRef<View>(null)
  const menuButtonRef = useRef<View>(null)
  const menuCardRef = useRef<View>(null)
  const firstMenuItemRef = useRef<View>(null)
  const launchBtnRef = useRef<View>(null)

  const showSecondaryActions =
    hovered || menuVisible || menuBtnHovered || menuBtnFocused || launchHovered || launchFocused
  const showLaunchTooltip = canShowTooltip && (launchHovered || launchFocused)
  const title = getProjectDisplayName(project, { showMachineName })

  const closeMenu = useCallback(() => setMenuVisible(false), [])
  useEscapeKey(menuVisible, closeMenu)
  useWebModalFocus({
    visible: menuVisible,
    containerRef: menuCardRef,
    initialFocusRef: firstMenuItemRef,
    returnFocusRef: menuButtonRef,
  })

  const openMenu = useCallback((event: GestureResponderEvent) => {
    event.stopPropagation()
    menuAnchorRef.current?.measure((_fx, _fy, measuredWidth, height, px, py) => {
      setMenuPos({ x: Math.max(8, px + measuredWidth - PROJECT_MENU_WIDTH), y: py + height + 4 })
      setMenuVisible(true)
    })
  }, [])

  useEffect(() => {
    if (!showLaunchTooltip) {
      onHideLaunchTooltip()
      return
    }
    launchBtnRef.current?.measure((_fx, _fy, buttonWidth, buttonHeight, px, py) => {
      onShowLaunchTooltip({
        top: py + buttonHeight + 6,
        right: Math.max(PROJECT_TOOLTIP_EDGE_GAP, width - px - buttonWidth),
      })
    })
  }, [onHideLaunchTooltip, onShowLaunchTooltip, showLaunchTooltip, width])

  return (
    <View
      style={[
        styles.projectHeader,
        {
          backgroundColor: pressed
            ? colors.surfaceHover
            : hovered
              ? colors.surfaceHover
              : pinned
                ? getPinnedSurfaceColor(colors, isDark)
                : 'transparent',
        },
      ]}
    >
      <Pressable
        style={[
          styles.projectHeaderPrimaryAction,
          { borderColor: primaryFocused ? colors.brand : 'transparent' },
        ]}
        onPress={() => {
          onToggleExpanded()
        }}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        onFocus={event => setPrimaryFocused((event.nativeEvent.target as unknown as HTMLElement)?.matches?.(':focus-visible') ?? false)}
        onBlur={() => setPrimaryFocused(false)}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded }}
      />
      <View pointerEvents="none" style={styles.projectHeaderLeft}>
        <Ionicons
          name={expanded ? 'folder-open-outline' : 'folder-outline'}
          size={15}
          color={colors.textSecondary}
        />
        <Text
          style={[styles.projectTitle, { color: offline ? colors.textTertiary : colors.text }]}
          numberOfLines={1}
          ellipsizeMode="middle"
        >
          {title}
        </Text>
        {offline ? (
          <Text
            style={[styles.projectOfflineLabel, { color: colors.textTertiary }]}
            numberOfLines={1}
          >
            {t('machine_offline')}
          </Text>
        ) : null}
      </View>

      <View style={styles.projectHeaderActions}>
        <UnreadCountBadge count={unreadCount} />
        <View
          ref={menuAnchorRef}
          collapsable={false}
          pointerEvents={showSecondaryActions ? 'auto' : 'none'}
          style={[
            styles.projectMenuWrap,
            !showSecondaryActions && styles.hiddenProjectAction,
            { opacity: showSecondaryActions ? 1 : 0 },
          ]}
        >
          <Pressable
            ref={menuButtonRef}
            style={[
              styles.projectIconBtn,
              { borderColor: menuBtnFocused ? colors.brand : 'transparent' },
            ]}
            onPress={openMenu}
            onHoverIn={() => setMenuBtnHovered(true)}
            onHoverOut={() => setMenuBtnHovered(false)}
            onFocus={() => setMenuBtnFocused(true)}
            onBlur={() => setMenuBtnFocused(false)}
            accessibilityRole="button"
            accessibilityLabel={t('project_actions')}
          >
            <Ionicons
              name="ellipsis-horizontal"
              size={desktopControlMetrics.compactIconGlyphSize}
              color={colors.textSecondary}
            />
          </Pressable>
        </View>
        <View
          ref={launchBtnRef}
          collapsable={false}
          pointerEvents={showSecondaryActions ? 'auto' : 'none'}
          style={[
            styles.projectLaunchWrap,
            !showSecondaryActions && styles.hiddenProjectAction,
            { opacity: showSecondaryActions ? 1 : 0 },
          ]}
        >
          <Pressable
            style={[
              styles.projectIconBtn,
              { borderColor: launchFocused ? colors.brand : 'transparent' },
            ]}
            onPress={(event) => {
              event.stopPropagation()
              onCreateSession()
            }}
            onHoverIn={() => setLaunchHovered(true)}
            onHoverOut={() => setLaunchHovered(false)}
            onFocus={() => setLaunchFocused(true)}
            onBlur={() => setLaunchFocused(false)}
            accessibilityRole="button"
            accessibilityLabel={t('start_new_chat')}
            accessibilityHint={t('start_new_chat_hint')}
          >
            <Ionicons
              name="create-outline"
              size={16}
              color={offline ? colors.textTertiary : colors.textSecondary}
            />
          </Pressable>
        </View>
      </View>

      <Modal visible={menuVisible} transparent animationType="none" onRequestClose={closeMenu}>
        <View style={styles.projectMenuOverlay}>
          <Pressable
            style={styles.projectMenuBackdrop}
            onPress={closeMenu}
            accessibilityRole="button"
            accessibilityLabel={t('cancel')}
          />
          <View
            ref={menuCardRef}
            accessibilityRole="menu"
            accessibilityViewIsModal
            style={[
              styles.projectMenuCard,
              {
                top: menuPos.y,
                left: menuPos.x,
                backgroundColor: colors.surface,
                borderColor: colors.border,
              },
            ]}
          >
            <View style={styles.projectMenuItem}>
              <Text style={[styles.projectMenuText, { color: colors.textSecondary }]}>
                {project.machineName}
              </Text>
            </View>
            <View style={styles.projectMenuItem}>
              <Text selectable style={[styles.projectMenuText, { color: colors.textSecondary }]}>
                {project.workDir}
              </Text>
            </View>
            <Pressable
              ref={firstMenuItemRef}
              accessibilityRole="menuitem"
              style={styles.projectMenuItem}
              onPress={() => {
                closeMenu()
                onTogglePin()
              }}
            >
              <Text style={[styles.projectMenuText, { color: colors.text }]}>
                {pinned ? t('unpin_project') : t('pin_project')}
              </Text>
            </Pressable>
            {onRemove ? (
              <Pressable
                accessibilityRole="menuitem"
                style={styles.projectMenuItem}
                onPress={() => {
                  closeMenu()
                  setRemoveConfirmVisible(true)
                }}
              >
                <Text style={[styles.projectMenuText, { color: colors.error }]}>
                  {t('remove_project')}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </Modal>
      <ProjectRemovalConfirmModal
        visible={removeConfirmVisible}
        onClose={() => setRemoveConfirmVisible(false)}
        onConfirm={() => {
          setRemoveConfirmVisible(false)
          onRemove?.()
        }}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  chrome: {
    height: desktopControlMetrics.headerHeight,
    zIndex: 20,
  },
  sectionHeaderAction: {
    width: desktopControlMetrics.compactControlHeight,
    height: desktopControlMetrics.compactControlHeight,
    borderWidth: 1,
    borderRadius: desktopControlMetrics.radiusSmall,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionHeader: {
    minHeight: 32,
    marginTop: 8,
    paddingLeft: 8,
    paddingRight: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionHeaderLabelButton: {
    flex: 1,
    minWidth: 0,
    minHeight: 32,
    borderWidth: 1,
    borderRadius: desktopControlMetrics.radiusSmall,
    paddingLeft: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  sectionHeaderLabel: desktopTypography.sidebarSection,
  projectHeader: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginRight: 8,
    borderRadius: desktopControlMetrics.radiusSmall,
    paddingLeft: 12,
    paddingRight: 8,
  },
  projectHeaderPrimaryAction: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 1,
    borderRadius: desktopControlMetrics.radiusSmall,
  },
  projectHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    flex: 1,
    minWidth: 0,
  },
  projectTitle: { ...desktopTypography.sidebarRoomTitle, flexShrink: 1 },
  projectOfflineLabel: { fontSize: 11, fontWeight: '600', flexShrink: 0 },
  projectHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 0,
    marginLeft: 8,
    justifyContent: 'flex-end',
    zIndex: 1,
  },
  projectIconBtn: {
    width: desktopControlMetrics.compactControlHeight,
    height: desktopControlMetrics.compactControlHeight,
    borderWidth: 1,
    borderRadius: desktopControlMetrics.radiusSmall,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Keep focusable controls within the row even while they reserve no space.
  // A zero-width wrapper leaves its 32px child outside the scroll viewport.
  hiddenProjectAction: { position: 'absolute', right: 0 },
  projectLaunchWrap: {
    width: desktopControlMetrics.compactControlHeight,
    height: desktopControlMetrics.compactControlHeight,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  projectMenuWrap: {
    width: desktopControlMetrics.compactControlHeight,
    height: desktopControlMetrics.compactControlHeight,
  },
  projectMenuOverlay: { flex: 1 },
  projectMenuBackdrop: { ...StyleSheet.absoluteFillObject },
  projectMenuCard: {
    position: 'absolute',
    width: PROJECT_MENU_WIDTH,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  projectMenuItem: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  projectMenuText: { ...desktopTypography.control, flexShrink: 1 },
})
