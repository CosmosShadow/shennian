// @arch docs/features/desktop-local-first-client.md#7-信息架构
import { useTheme } from '../../hooks/useTheme'

/**
 * Scope the lighter scrollbars to Desktop navigation and message surfaces. The
 * Room Agent tab strip scrolls without any bar: Windows would otherwise draw
 * classic scrollbar arrows inside the 44px header.
 */
export function DesktopScrollbarStyles() {
  const { isDark } = useTheme()
  const targets = '[data-testid="desktop-sidebar-navigation-list"], [data-testid="desktop-room-public-messages"], .cwv-desktop'
  const thumb = isDark ? 'rgba(220,225,235,.28)' : 'rgba(85,95,110,.28)'
  const hover = isDark ? 'rgba(220,225,235,.48)' : 'rgba(85,95,110,.48)'
  return <style>{`
    :is(${targets}) { scrollbar-width: thin; scrollbar-color: ${thumb} transparent; }
    :is(${targets})::-webkit-scrollbar { width: 6px; height: 6px; }
    :is(${targets})::-webkit-scrollbar-track { background: transparent; }
    :is(${targets})::-webkit-scrollbar-thumb { background: ${thumb}; border-radius: 6px; }
    :is(${targets})::-webkit-scrollbar-thumb:hover { background: ${hover}; }
    [data-testid="desktop-room-agent-tabs"] { overflow-x: auto; overflow-y: hidden; scrollbar-width: none; }
    [data-testid="desktop-room-agent-tabs"]::-webkit-scrollbar { display: none; }
    @media (forced-colors: active) { :is(${targets}) { scrollbar-color: auto; } }
  `}</style>
}
