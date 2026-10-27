// @arch docs/features/desktop-local-first-client.md#7-信息架构
// @test src/__tests__/desktop-sidebar-virtualization.test.ts
import React, { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from 'react-native'
import type { SidebarTreeItem } from '../../components/sidebarTreeModel'
import { navigationAnchorCorrection, navigationIndexAt, navigationOffsets, navigationRange, navigationTargetOffset } from './desktopNavigationListModel'

export type DesktopNavigationListHandle = {
  scrollToOffset: (options: { offset: number; animated?: boolean }) => void
  scrollToIndex: (options: { index: number; animated?: boolean; viewPosition?: number }) => void
}
export type NavigationRenderItem = { item: SidebarTreeItem; index: number }
type Props = {
  data: SidebarTreeItem[]
  renderItem: (info: NavigationRenderItem) => ReactNode
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void
  onLayout: (event: LayoutChangeEvent) => void
  onContentSizeChange: () => void
  onViewableItemsChanged: (info: { viewableItems: { item: SidebarTreeItem; isViewable: boolean }[] }) => void
}

// Scroll-window updates must not re-run the hooks and menus of retained rows.
const NavigationRow = memo(function NavigationRow({ item, index, renderItem }: NavigationRenderItem & Pick<Props, 'renderItem'>) {
  return <>{renderItem({ item, index })}</>
})

/** Browser scrolling + one ResizeObserver; no RN scroll responder or per-cell onLayout. */
export const DesktopNavigationList = forwardRef<DesktopNavigationListHandle, Props>(function DesktopNavigationList(props, ref) {
  const { data, renderItem } = props
  const rootRef = useRef<HTMLDivElement>(null)
  const heights = useRef(new Map<string, number>())
  const [revision, setRevision] = useState(0)
  const offsets = useMemo(() => navigationOffsets(data, heights.current), [data, revision])
  const totalHeight = (offsets[offsets.length - 1] ?? 4) + 12
  const [range, setRange] = useState(() => navigationRange(offsets, 0, 800))
  const [focusedKey, setFocusedKey] = useState<string | null>(null)
  const latest = useRef({ props, offsets, totalHeight })
  latest.current = { props, offsets, totalHeight }
  const pendingTarget = useRef<{ key: string; viewPosition?: number } | null>(null)
  const anchor = useRef<{ key: string; rowTop: number } | null>(null)
  const frame = useRef(0)
  const observerRef = useRef<ResizeObserver | null>(null)
  const rowNodes = useRef(new Map<string, HTMLDivElement>())
  const rowRefs = useRef(new Map<string, (node: HTMLDivElement | null) => void>())

  const updateViewport = useCallback(() => {
    const root = rootRef.current
    if (!root) return
    const { props: current, offsets: positions } = latest.current
    const top = root.scrollTop
    const height = root.clientHeight
    const first = navigationIndexAt(positions, top)
    const last = navigationIndexAt(positions, top + height)
    const item = current.data[first]
    anchor.current = item ? { key: item.key, rowTop: positions[first] } : null
    setRange(previous => {
      // Hysteresis keeps small scrolls entirely on the compositor without React work.
      if (previous.end <= current.data.length
        && (previous.start === 0 || top >= positions[previous.start] + 200)
        && (previous.end === current.data.length || top + height <= positions[previous.end] - 200)) return previous
      return navigationRange(positions, top, height)
    })
    current.onViewableItemsChanged({ viewableItems: current.data.slice(first, last + 1).map(item => ({ item, isViewable: true })) })
  }, [])

  useImperativeHandle(ref, () => ({
    scrollToOffset({ offset, animated }) {
      pendingTarget.current = null
      rootRef.current?.scrollTo({ top: offset, behavior: animated ? 'smooth' : 'instant' })
      updateViewport()
    },
    scrollToIndex(options) {
      const root = rootRef.current
      if (!root) return
      const key = latest.current.props.data[options.index]?.key
      pendingTarget.current = key ? { key, viewPosition: options.viewPosition } : null
      root.scrollTo({ top: navigationTargetOffset(latest.current.offsets, options.index, root.clientHeight, options.viewPosition), behavior: options.animated ? 'smooth' : 'instant' })
      setRange(navigationRange(latest.current.offsets, root.scrollTop, root.clientHeight))
      updateViewport()
    },
  }), [updateViewport])

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const target = pendingTarget.current
    if (target) {
      const index = data.findIndex(item => item.key === target.key)
      if (index >= 0) root.scrollTop = navigationTargetOffset(offsets, index, root.clientHeight, target.viewPosition)
      if (index < 0 || heights.current.has(target.key)) pendingTarget.current = null
    } else if (anchor.current) {
      const index = data.findIndex(item => item.key === anchor.current!.key)
      if (index >= 0) {
        const next = navigationAnchorCorrection(root.scrollTop, anchor.current.rowTop, offsets[index])
        if (next !== null) root.scrollTop = next
      }
    }
    props.onContentSizeChange()
    updateViewport()
  }, [data, offsets, props.onContentSizeChange, updateViewport])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const onScroll = () => {
      if (frame.current) return
      frame.current = requestAnimationFrame(() => {
        frame.current = 0
        updateViewport()
        latest.current.props.onScroll({ nativeEvent: {
          contentOffset: { x: 0, y: root.scrollTop },
          contentSize: { width: root.clientWidth, height: latest.current.totalHeight },
          layoutMeasurement: { width: root.clientWidth, height: root.clientHeight },
        } } as NativeSyntheticEvent<NativeScrollEvent>)
      })
    }
    const releaseTarget = () => { pendingTarget.current = null }
    root.addEventListener('scroll', onScroll, { passive: true })
    root.addEventListener('wheel', releaseTarget, { passive: true })
    root.addEventListener('pointerdown', releaseTarget, { passive: true })
    root.addEventListener('keydown', releaseTarget)
    const observer = new ResizeObserver(entries => {
      let changed = false
      for (const entry of entries) {
        if (entry.target === root) {
          latest.current.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: entry.contentRect.width, height: entry.contentRect.height } } } as LayoutChangeEvent)
          continue
        }
        const key = (entry.target as HTMLElement).dataset.navigationKey
        const height = entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height
        if (key && height > 0 && Math.abs((heights.current.get(key) ?? 0) - height) > 0.5) {
          heights.current.set(key, height)
          changed = true
        }
      }
      if (changed) setRevision(value => value + 1)
      updateViewport()
    })
    observerRef.current = observer
    observer.observe(root)
    rowNodes.current.forEach(node => observer.observe(node))
    updateViewport()
    return () => {
      observer.disconnect()
      observerRef.current = null
      cancelAnimationFrame(frame.current)
      frame.current = 0
      root.removeEventListener('scroll', onScroll)
      root.removeEventListener('wheel', releaseTarget)
      root.removeEventListener('pointerdown', releaseTarget)
      root.removeEventListener('keydown', releaseTarget)
    }
  }, [updateViewport])

  useEffect(() => {
    const keys = new Set<string>(data.map(item => item.key))
    heights.current.forEach((_value, key) => { if (!keys.has(key)) heights.current.delete(key) })
    rowRefs.current.forEach((_value, key) => { if (!keys.has(key)) rowRefs.current.delete(key) })
  }, [data])

  const indices = new Set<number>()
  for (let index = range.start; index < Math.min(range.end, data.length); index++) indices.add(index)
  const focusedIndex = focusedKey ? data.findIndex(item => item.key === focusedKey) : -1
  if (focusedIndex >= 0) indices.add(focusedIndex)
  return <div ref={rootRef} data-testid="desktop-sidebar-navigation-list"
    style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', overscrollBehavior: 'contain', overflowAnchor: 'none' }}
    onFocusCapture={event => setFocusedKey((event.target as HTMLElement).closest<HTMLElement>('[data-navigation-key]')?.dataset.navigationKey ?? null)}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusedKey(null) }}>
    <div style={{ position: 'relative', height: totalHeight }}>
      {[...indices].sort((a, b) => a - b).map(index => {
        const item = data[index]
        if (!rowRefs.current.has(item.key)) rowRefs.current.set(item.key, node => {
          const previous = rowNodes.current.get(item.key)
          if (previous) observerRef.current?.unobserve(previous)
          if (node) { rowNodes.current.set(item.key, node); observerRef.current?.observe(node) }
          else rowNodes.current.delete(item.key)
        })
        return <div key={item.key} ref={rowRefs.current.get(item.key)} data-navigation-key={item.key}
          style={{ position: 'absolute', top: offsets[index], left: 0, right: 0, display: 'flow-root' }}>
          <NavigationRow item={item} index={index} renderItem={renderItem} />
        </div>
      })}
    </div>
  </div>
})
