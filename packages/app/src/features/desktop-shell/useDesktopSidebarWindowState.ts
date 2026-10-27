// @arch docs/design/desktop/unified-desktop-control.md#窗口与状态协议设计约束非新增-wire
// @test ../../__tests__/desktop-shell-window-state.test.ts
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore, type SetStateAction } from 'react'
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from 'react-native'
import type { DesktopNavigationListHandle } from './DesktopNavigationList'
import { desktopShellWindowState, type DesktopShellNavigation, type DesktopShellSection } from './desktopShellWindowState'
import { DesktopNavigationScrollRestoration, isDesktopNavigationResizeClamp } from './desktopNavigationScrollRestoration'

export function useDesktopSidebarWindowState(accountId: string, ready: boolean) {
  const snapshot = useSyncExternalStore(desktopShellWindowState.subscribe,
    () => desktopShellWindowState.get(accountId), () => desktopShellWindowState.get(accountId))
  const listRef = useRef<DesktopNavigationListHandle>(null)
  const scrollRestoration = useRef(
    new DesktopNavigationScrollRestoration(accountId, ready),
  ).current
  const setField = useCallback(<K extends keyof DesktopShellNavigation>(key: K, action: SetStateAction<DesktopShellNavigation[K]>) => {
    desktopShellWindowState.updateNavigation(accountId, current => {
      const value = typeof action === 'function' ? (action as (value: DesktopShellNavigation[K]) => DesktopShellNavigation[K])(current[key]) : action
      return value === current[key] ? current : { ...current, [key]: value }
    })
  }, [accountId])
  const setters = useMemo(() => ({
    setProjectExpanded: (projectKey: string, expanded: boolean) => desktopShellWindowState.setProjectExpanded(accountId, projectKey, expanded),
    setExpandedKeys: (value: SetStateAction<Record<string, boolean>>) => setField('expandedKeys', value),
    setVisibleSessionCounts: (value: SetStateAction<Record<string, number>>) => setField('visibleSessionCounts', value),
    setSectionExpanded: (section: DesktopShellSection, expanded: boolean) => desktopShellWindowState.setSectionExpanded(accountId, section, expanded),
    setProjectsOpen: (value: SetStateAction<boolean>) => setField('projectsOpen', value),
    setRoomsOpen: (value: SetStateAction<boolean>) => setField('roomsOpen', value),
    setAgentsOpen: (value: SetStateAction<boolean>) => setField('agentsOpen', value),
    setMachinesOpen: (value: SetStateAction<boolean>) => setField('machinesOpen', value),
  }), [accountId, setField])
  const restoreNavigationScroll = useCallback(() => {
    if (!listRef.current) return
    const offset = scrollRestoration.takeOffset(
      accountId,
      desktopShellWindowState.get(accountId).navigation.scrollOffset,
    )
    if (offset === null) return
    listRef.current.scrollToOffset({ offset, animated: false })
  }, [accountId, scrollRestoration])
  const onNavigationContentSizeChange = useCallback(() => {
    scrollRestoration.markContentMeasured(accountId)
    restoreNavigationScroll()
  }, [accountId, restoreNavigationScroll, scrollRestoration])
  const onNavigationLayout = useCallback((event: LayoutChangeEvent) => {
    scrollRestoration.markViewportMeasured(accountId, event.nativeEvent.layout.height)
    restoreNavigationScroll()
  }, [accountId, restoreNavigationScroll, scrollRestoration])
  useLayoutEffect(() => {
    scrollRestoration.update(accountId, ready)
  }, [accountId, ready, scrollRestoration])
  useEffect(() => {
    const frame = requestAnimationFrame(restoreNavigationScroll)
    return () => cancelAnimationFrame(frame)
  }, [restoreNavigationScroll])
  useEffect(() => {
    if (typeof window === 'undefined') return
    let timer: ReturnType<typeof setTimeout> | undefined
    const onResize = () => {
      scrollRestoration.beginViewportResize(accountId)
      clearTimeout(timer)
      timer = setTimeout(() => {
        scrollRestoration.endViewportResize(accountId)
        restoreNavigationScroll()
      }, 150)
    }
    window.addEventListener('resize', onResize)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('resize', onResize)
      scrollRestoration.endViewportResize(accountId)
    }
  }, [accountId, restoreNavigationScroll, scrollRestoration])
  const onNavigationScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!scrollRestoration.acceptsScroll(accountId)) return
    const offset = Math.max(0, event.nativeEvent.contentOffset.y)
    if (!Number.isFinite(offset)) return
    if (isDesktopNavigationResizeClamp(offset, desktopShellWindowState.get(accountId).navigation.scrollOffset,
      event.nativeEvent.contentSize.height, event.nativeEvent.layoutMeasurement.height)) return
    desktopShellWindowState.recordNavigationScroll(accountId, offset)
  }, [accountId, scrollRestoration])
  return { ...snapshot.navigation, ...setters, listRef, onNavigationContentSizeChange, onNavigationLayout, onNavigationScroll }
}
