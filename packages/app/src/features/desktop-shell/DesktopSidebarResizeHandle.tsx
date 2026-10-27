// @arch docs/design/desktop/unified-desktop-control.md#窗口与状态协议设计约束非新增-wire
// @test ../../__tests__/desktop-sidebar-width.test.ts
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../hooks/useTheme'
import { DESKTOP_SIDEBAR_MIN_WIDTH, DESKTOP_SIDEBAR_MAX_WIDTH, getDesktopSidebarWidth } from './desktopSidebarWidth'
import { desktopControlMetrics } from './desktopDesignTokens'
import { bindDesktopFilePanelPointerEvents } from './desktopFilePanelState'

type Props = {
  width: number
  windowWidth: number
  onPreview: (width: number | null) => void
  onCommit: (width: number) => void
}

/** App-window listeners survive layout changes during a drag; cancellation never saves. */
export function DesktopSidebarResizeHandle({ width, windowWidth, onPreview, onCommit }: Props) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const [focused, setFocused] = useState(false)
  const [hovered, setHovered] = useState(false)
  const drag = useRef<{ pointer: number; startX: number; startWidth: number; width: number } | null>(null)
  const detach = useRef<(() => void) | null>(null)
  const maximum = getDesktopSidebarWidth(windowWidth, DESKTOP_SIDEBAR_MAX_WIDTH)
  useEffect(() => () => { drag.current = null; detach.current?.() }, [])
  const cancel = () => { drag.current = null; detach.current?.(); onPreview(null) }
  return <div
    role="separator"
    aria-label={t('desktop_sidebar_resize')}
    aria-orientation="vertical"
    aria-valuemin={DESKTOP_SIDEBAR_MIN_WIDTH}
    aria-valuemax={maximum}
    aria-valuenow={Math.round(width)}
    tabIndex={0}
    onFocus={() => setFocused(true)}
    onBlur={() => setFocused(false)}
    onPointerEnter={() => setHovered(true)}
    onPointerLeave={() => setHovered(false)}
    onPointerDown={event => {
      if (event.button !== 0) return
      event.preventDefault()
      event.currentTarget.focus({ preventScroll: true })
      detach.current?.()
      drag.current = { pointer: event.pointerId, startX: event.clientX, startWidth: width, width }
      detach.current = bindDesktopFilePanelPointerEvents(window, {
        move: pointerEvent => {
          const current = drag.current
          if (!current || current.pointer !== pointerEvent.pointerId) return
          current.width = getDesktopSidebarWidth(windowWidth, current.startWidth + pointerEvent.clientX - current.startX)
          onPreview(current.width)
        },
        finish: () => {
          const current = drag.current
          drag.current = null
          if (current && current.width !== current.startWidth) onCommit(current.width)
          onPreview(null)
        },
        cancel,
      })
    }}
    onKeyDown={event => {
      if (event.key === 'Escape' && drag.current) {
        event.preventDefault(); event.stopPropagation(); cancel(); return
      }
      const next = event.key === 'ArrowLeft' ? width - 10
        : event.key === 'ArrowRight' ? width + 10
        : event.key === 'Home' ? DESKTOP_SIDEBAR_MIN_WIDTH
        : event.key === 'End' ? maximum : null
      if (next === null) return
      event.preventDefault(); event.stopPropagation()
      onCommit(getDesktopSidebarWidth(windowWidth, next))
    }}
    style={{ position: 'absolute', right: 0, top: desktopControlMetrics.headerHeight, bottom: 0, width: 6,
      zIndex: 60, cursor: 'col-resize', touchAction: 'none', outline: 'none',
      background: focused || hovered
        ? `linear-gradient(to right, transparent 2px, ${focused ? colors.brand : colors.border} 2px, ${focused ? colors.brand : colors.border} 4px, transparent 4px)`
        : 'transparent' }}
  />
}
