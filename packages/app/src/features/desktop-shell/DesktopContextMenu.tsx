// @arch docs/design/desktop/macos-interaction-baseline.md
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { createPortal, flushSync } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../hooks/useTheme'
import { desktopFontFamily } from './desktopDesignTokens'

export type DesktopMenuAction = {
  label: string
  onSelect(): void
  destructive?: boolean
  disabled?: boolean
}

/** Pointer-anchored actions with an equivalent Shift+F10 / Menu-key entry. */
export function useDesktopContextMenu() {
  const [anchor, setAnchor] = useState<{ x: number; y: number; trigger: HTMLElement } | null>(null)
  const close = () => setAnchor(null)
  const open = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setAnchor({ x: event.clientX, y: event.clientY, trigger: event.currentTarget })
  }
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
    event.preventDefault()
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    setAnchor({ x: rect.left + 8, y: rect.bottom, trigger: event.currentTarget })
  }
  return {
    anchor,
    close,
    openFromElement: (trigger: HTMLElement) => {
      const rect = trigger.getBoundingClientRect()
      setAnchor({ x: rect.left, y: rect.bottom, trigger })
    },
    bindings: { onContextMenu: open, onKeyDown, 'aria-haspopup': 'menu' as const },
  }
}

export function DesktopContextMenu({
  menu,
  actions,
}: {
  menu: ReturnType<typeof useDesktopContextMenu>
  actions: DesktopMenuAction[]
}) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: 0, top: 0 })
  const anchor = menu.anchor
  useLayoutEffect(() => {
    if (!anchor) return
    const node = ref.current
    const rect = node?.getBoundingClientRect()
    setPosition({
      left: Math.max(8, Math.min(anchor.x, window.innerWidth - (rect?.width ?? 240) - 8)),
      top: Math.max(8, Math.min(anchor.y, window.innerHeight - (rect?.height ?? 200) - 8)),
    })
    node?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true })
    return () => {
      anchor.trigger?.focus?.({ preventScroll: true })
    }
  }, [anchor])
  if (!anchor || typeof document === 'undefined') return null
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault()
      menu.close()
      return
    }
    const items = Array.from(
      ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [],
    )
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    const next =
      event.key === 'ArrowDown'
        ? (current + 1) % items.length
        : event.key === 'ArrowUp'
          ? (current - 1 + items.length) % items.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? items.length - 1
              : null
    if (next !== null) {
      event.preventDefault()
      items[next]?.focus()
    }
  }
  return createPortal(
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 10000 }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) menu.close()
      }}
      onContextMenu={(event) => {
        event.preventDefault()
        menu.close()
      }}
    >
      <style>
        {
          '.desktop-context-action { background:transparent; } .desktop-context-action:hover,.desktop-context-action:focus-visible { background:var(--menu-hover); outline:none; }'
        }
      </style>
      <div
        ref={ref}
        role="menu"
        aria-label={t('more')}
        onKeyDown={onKeyDown}
        onContextMenu={(event) => event.stopPropagation()}
        style={
          {
            position: 'fixed',
            ...position,
            minWidth: 220,
            maxWidth: 'calc(100vw - 16px)',
            padding: 5,
            border: `1px solid ${colors.border}`,
            borderRadius: 9,
            background: colors.bg,
            boxShadow: '0 8px 28px rgba(0,0,0,.16)',
            fontFamily: desktopFontFamily,
            '--menu-hover': colors.surfaceHover,
          } as React.CSSProperties
        }
      >
        {actions.map((action, index) => (
          <button
            key={index}
            type="button"
            role="menuitem"
            className="desktop-context-action"
            disabled={action.disabled}
            onClick={() => {
              flushSync(() => menu.close())
              action.onSelect()
            }}
            style={{
              display: 'block',
              width: '100%',
              border: 0,
              borderRadius: 5,
              padding: '7px 12px',
              minHeight: 32,
              textAlign: 'left',
              fontFamily: 'inherit',
              fontSize: 13,
              lineHeight: '18px',
              fontWeight: 400,
              color: action.destructive ? colors.errorText : colors.text,
              cursor: 'default',
              opacity: action.disabled ? 0.5 : 1,
            }}
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>,
    document.body,
  )
}
