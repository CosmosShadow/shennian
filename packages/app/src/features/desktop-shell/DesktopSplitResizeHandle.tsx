// @arch docs/design/desktop/macos-interaction-baseline.md
// @test ../../__tests__/desktop-room-workspace.test.ts
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { useTheme } from '../../hooks/useTheme'
import { useTranslation } from 'react-i18next'
import { desktopShellWindowState } from './desktopShellWindowState'
import { bindDesktopFilePanelPointerEvents } from './desktopFilePanelState'
import { DESKTOP_SIDEBAR_DEFAULT_WIDTH, DESKTOP_SIDEBAR_MAX_WIDTH } from './desktopSidebarWidth'

import { clampDesktopSplitWidth } from '../desktop-rooms/desktopRoomWorkspaceLayout'

// The detail root gains its layout handler after asynchronous loading. Observe the
// actual DOM node so its first measured width cannot remain the loading width.
export function useDesktopAvailableWidth() {
  const [availableWidth, setWidth] = useState(0)
  const observer = useRef<ResizeObserver | null>(null)
  const measureRef = useCallback((node: unknown) => {
    observer.current?.disconnect()
    if (!(node instanceof HTMLElement)) return
    const measure = () => setWidth(Math.round(node.getBoundingClientRect().width))
    measure()
    observer.current = new ResizeObserver(measure)
    observer.current.observe(node)
  }, [])
  useEffect(() => () => observer.current?.disconnect(), [])
  return { availableWidth, measureRef }
}

type Kind = 'agentNavigationWidth' | 'roomSplitWidth'
export function useDesktopSplitWidth(accountId: string, kind: Kind, available: number) {
  const snapshot = useSyncExternalStore(desktopShellWindowState.subscribe,
    () => desktopShellWindowState.get(accountId), () => desktopShellWindowState.get(accountId))
  const [preview, setPreview] = useState<number | null>(null)
  const minimum = kind === 'agentNavigationWidth' ? 280 : 360
  const maximum = kind === 'agentNavigationWidth' ? DESKTOP_SIDEBAR_MAX_WIDTH : Math.max(minimum, available - 360)
  const preferred = preview ?? snapshot.panels[kind] ??
    (kind === 'agentNavigationWidth' ? DESKTOP_SIDEBAR_DEFAULT_WIDTH : available / 2)
  const width = Math.min(maximum, clampDesktopSplitWidth(preferred, available, minimum))
  useEffect(() => setPreview(null), [accountId, available, kind])
  return { width, minimum, maximum, available, onPreview: setPreview,
    onCommit: (value: number | null) => desktopShellWindowState.setSplitWidth(accountId, kind, value) }
}

export function DesktopSplitResizeHandle({ width, minimum, maximum, available, onPreview, onCommit }: ReturnType<typeof useDesktopSplitWidth>) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const [active, setActive] = useState(false)
  const drag = useRef<{ x: number; width: number; next: number; pointer: number } | null>(null)
  const detach = useRef<(() => void) | null>(null)
  const clamp = (value: number) => Math.max(minimum, Math.min(value, maximum))
  const cancel = () => { drag.current = null; detach.current?.(); onPreview(null); setActive(false) }
  useEffect(() => { drag.current = null; detach.current?.(); setActive(false); return () => { drag.current = null; detach.current?.() } }, [available]) // viewport change cancels a drag
  return <div role="separator" aria-orientation="vertical" aria-label={t('desktop_split_resize')}
    aria-valuemin={minimum} aria-valuemax={maximum} aria-valuenow={Math.round(width)} tabIndex={0}
    onDoubleClick={() => { cancel(); onCommit(null) }}
    onPointerDown={event => {
      if (event.button !== 0) return
      event.preventDefault(); event.currentTarget.focus({ preventScroll: true }); detach.current?.()
      drag.current = { x: event.clientX, width, next: width, pointer: event.pointerId }; setActive(true)
      detach.current = bindDesktopFilePanelPointerEvents(window, {
        move: event => {
          const current = drag.current
          if (!current || event.pointerId !== current.pointer) return
          current.next = clamp(current.width + event.clientX - current.x)
          onPreview(current.next)
        },
        finish: () => { const current = drag.current; drag.current = null; if (current) onCommit(current.next); onPreview(null); setActive(false) },
        cancel,
      })
    }}
    onKeyDown={event => {
      if (event.key === 'Escape') { cancel(); event.preventDefault(); return }
      if (event.key === 'Enter') { onCommit(null); event.preventDefault(); return }
      const next = event.key === 'ArrowLeft' ? width - 10 : event.key === 'ArrowRight' ? width + 10
        : event.key === 'Home' ? minimum : event.key === 'End' ? maximum : null
      if (next !== null) { event.preventDefault(); onCommit(clamp(next)) }
    }}
    style={{ position: 'absolute', left: width - 3, top: 0, bottom: 0, width: 6, zIndex: 50,
      cursor: 'col-resize', touchAction: 'none', WebkitAppRegion: 'no-drag',
      background: active ? colors.border : 'transparent' } as CSSProperties} />
}
