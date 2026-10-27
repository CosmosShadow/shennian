// @arch docs/features/desktop-local-first-client.md#54-同步与服务器压力
// @test src/__tests__/chat-web-timeline-virtualization.test.ts

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'

export const WEB_TIMELINE_MAX_ITEMS = 48
export const WEB_TIMELINE_INITIAL_ITEMS = 16
export const WEB_TIMELINE_ACTIVE_ITEMS = 32
export const WEB_TIMELINE_SCROLL_ROOT_STYLE = { overflowAnchor: 'none' as const }
const WEB_TIMELINE_OVERSCAN_PX = 640
const WEB_TIMELINE_RUNWAY_ITEMS = 8
const DEFAULT_ITEM_HEIGHT = 180

export function settleWebTimelineFollowedViewport(
  root: { scrollHeight: number; clientHeight: number; scrollTop: number },
  initial: boolean,
): boolean {
  const isNearBottom = root.scrollHeight - root.clientHeight - root.scrollTop < 150
  if (!initial && !isNearBottom) return false
  root.scrollTop = root.scrollHeight
  return true
}

export type WebTimelineRange = { start: number; end: number }

export function estimateWebTimelineItemHeight(item: unknown): number {
  if (!item || typeof item !== 'object') return DEFAULT_ITEM_HEIGHT
  const value = item as {
    message?: { content?: string; thinking?: string; attachments?: unknown[] }
    messages?: Array<{ content?: string; thinking?: string; attachments?: unknown[] }>
    finalMessage?: { content?: string; thinking?: string; attachments?: unknown[] }
  }
  const messages = value.message
    ? [value.message]
    : [...(value.messages ?? []), ...(value.finalMessage ? [value.finalMessage] : [])]
  let characters = 0
  let attachments = 0
  for (const message of messages) {
    characters += String(message.content ?? '').length + String(message.thinking ?? '').length
    attachments += message.attachments?.length ?? 0
  }
  return Math.max(80, Math.min(1_800, 72 + Math.ceil(characters / 36) * 22 + attachments * 96))
}

export function buildEstimatedOffsets(
  count: number,
  heightAt: (index: number) => number,
): number[] {
  const offsets = new Array<number>(count + 1)
  offsets[0] = 0
  for (let index = 0; index < count; index += 1) {
    offsets[index + 1] = offsets[index] + Math.max(1, heightAt(index))
  }
  return offsets
}

export function findIndexAtOffset(offsets: number[], offset: number): number {
  const count = Math.max(0, offsets.length - 1)
  if (count === 0) return 0
  const target = Math.max(0, offset)
  let low = 0
  let high = count - 1
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (offsets[middle + 1] > target) high = middle
    else low = middle + 1
  }
  return low
}

export function calculateWebTimelineRange(input: {
  count: number
  scrollTop: number
  viewportHeight: number
  offsets: number[]
  initialBottom?: boolean
}): WebTimelineRange {
  if (input.count <= WEB_TIMELINE_MAX_ITEMS) return { start: 0, end: input.count }
  if (input.initialBottom) {
    return {
      start: Math.max(0, input.count - WEB_TIMELINE_INITIAL_ITEMS),
      end: input.count,
    }
  }
  const first = findIndexAtOffset(
    input.offsets,
    Math.max(0, input.scrollTop - WEB_TIMELINE_OVERSCAN_PX),
  )
  const last = findIndexAtOffset(
    input.offsets,
    input.scrollTop + Math.max(1, input.viewportHeight) + WEB_TIMELINE_OVERSCAN_PX,
  )
  // Keep a stable runway on both sides of the viewport. Moving a small
  // fixed-size window on every crossed row forces React reconciliation and
  // synchronous layout during momentum scrolling, which presents as a hitch.
  const wanted = Math.max(
    WEB_TIMELINE_ACTIVE_ITEMS,
    last - first + 1 + WEB_TIMELINE_RUNWAY_ITEMS * 2,
  )
  const size = Math.min(WEB_TIMELINE_MAX_ITEMS, wanted)
  const start = Math.min(
    Math.max(0, first - WEB_TIMELINE_RUNWAY_ITEMS),
    Math.max(0, input.count - size),
  )
  return { start, end: Math.min(input.count, start + size) }
}

export function relocateWebTimelineRange(
  previousKeys: string[],
  nextKeys: string[],
  range: WebTimelineRange,
): WebTimelineRange | null {
  const firstKey = previousKeys[range.start]
  if (!firstKey) return null
  const relocatedStart = nextKeys.indexOf(firstKey)
  if (relocatedStart < 0) return null
  const size = Math.max(1, Math.min(WEB_TIMELINE_MAX_ITEMS, range.end - range.start))
  return {
    start: relocatedStart,
    end: Math.min(nextKeys.length, relocatedStart + size),
  }
}

export function compensateWebTimelineScrollTop(
  currentScrollTop: number,
  previousAnchorContentTop: number,
  nextAnchorContentTop: number,
): number {
  return Math.max(0, currentScrollTop + nextAnchorContentTop - previousAnchorContentTop)
}

function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

export type WebTimelineHandle = {
  scrollToIndex: (index: number, behavior?: ScrollBehavior) => void
  scrollToTop: (behavior?: ScrollBehavior) => void
  scrollToBottom: (behavior?: ScrollBehavior) => void
  withAllItems: <T>(task: () => Promise<T>) => Promise<T>
}

type KeyedItem = { key: string }

type Props<T extends KeyedItem> = {
  items: T[]
  scrollRootRef: RefObject<HTMLDivElement | null>
  estimateHeight?: (item: T) => number
  header?: ReactNode
  footer?: ReactNode
  renderItem: (item: T, index: number) => ReactNode
}

type AnchorSnapshot = { key: string; offsetWithinItem: number }

export function captureWebTimelineAnchor(
  keys: string[],
  offsets: number[],
  scrollTop: number,
): AnchorSnapshot | null {
  if (keys.length === 0 || offsets.length !== keys.length + 1) return null
  const index = findIndexAtOffset(offsets, scrollTop)
  const key = keys[index]
  if (!key) return null
  return { key, offsetWithinItem: Math.max(0, scrollTop - offsets[index]) }
}

export function restoreWebTimelineAnchor(
  keys: string[],
  offsets: number[],
  snapshot: AnchorSnapshot | null,
  fallbackScrollTop: number,
): number {
  if (!snapshot || offsets.length !== keys.length + 1) return fallbackScrollTop
  const index = keys.indexOf(snapshot.key)
  if (index < 0) return fallbackScrollTop
  return Math.max(0, offsets[index] + snapshot.offsetWithinItem)
}

export function restoreWebTimelineAfterMeasurement(input: {
  followsBottom: boolean
  scrollHeight: number
  keys: string[]
  offsets: number[]
  snapshot: AnchorSnapshot | null
  fallbackScrollTop: number
}): number {
  if (input.followsBottom) return input.scrollHeight
  return restoreWebTimelineAnchor(
    input.keys,
    input.offsets,
    input.snapshot,
    input.fallbackScrollTop,
  )
}

function VirtualizedWebTimelineInner<T extends KeyedItem>(
  {
    items,
    scrollRootRef,
    estimateHeight = () => DEFAULT_ITEM_HEIGHT,
    header,
    footer,
    renderItem,
  }: Props<T>,
  ref: React.ForwardedRef<WebTimelineHandle>,
) {
  const measuredHeightsRef = useRef(new Map<string, number>())
  const previousKeysRef = useRef<string[]>([])
  const previousOffsetsRef = useRef<number[]>([])
  const anchorSnapshotRef = useRef<AnchorSnapshot | null>(null)
  const measuredViewportRef = useRef<{
    followsBottom: boolean
    anchor: AnchorSnapshot | null
  } | null>(null)
  const followsBottomRef = useRef(true)
  const [measurementRevision, setMeasurementRevision] = useState(0)
  const [renderAll, setRenderAll] = useState(false)
  const [range, setRange] = useState<WebTimelineRange>(() =>
    calculateWebTimelineRange({
      count: items.length,
      scrollTop: 0,
      viewportHeight: 1,
      offsets: buildEstimatedOffsets(items.length, (index) => estimateHeight(items[index])),
      initialBottom: true,
    }),
  )
  const rangeRef = useRef(range)
  rangeRef.current = range

  const commitRange = useCallback((next: WebTimelineRange) => {
    const current = rangeRef.current
    if (current.start === next.start && current.end === next.end) return false
    rangeRef.current = next
    setRange(next)
    return true
  }, [])

  const offsets = useMemo(
    () =>
      buildEstimatedOffsets(items.length, (index) => {
        const item = items[index]
        return measuredHeightsRef.current.get(item.key) ?? estimateHeight(item)
      }),
    [estimateHeight, items, measurementRevision],
  )

  const keys = useMemo(() => items.map((item) => item.key), [items])

  const updateRangeFromViewport = useCallback(() => {
    if (renderAll) return
    const root = scrollRootRef.current
    if (!root) return
    const next = calculateWebTimelineRange({
      count: items.length,
      scrollTop: root.scrollTop,
      viewportHeight: root.clientHeight,
      offsets,
    })
    const current = rangeRef.current
    if (current.start === next.start && current.end === next.end) return
    commitRange(next)
  }, [commitRange, items.length, offsets, renderAll, scrollRootRef])

  useEffect(() => {
    const root = scrollRootRef.current
    if (!root) return
    let frame = 0
    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        followsBottomRef.current =
          root.scrollHeight - root.clientHeight - root.scrollTop < 150
        updateRangeFromViewport()
      })
    }
    root.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      root.removeEventListener('scroll', onScroll)
    }
  }, [scrollRootRef, updateRangeFromViewport])

  useLayoutEffect(() => {
    const root = scrollRootRef.current
    if (!root || renderAll) return
    const previousKeys = previousKeysRef.current
    const currentRange = rangeRef.current
    const wasAtBottom = followsBottomRef.current
    const relocated = relocateWebTimelineRange(previousKeys, keys, currentRange)
    if (!wasAtBottom && previousKeys.length > 0) {
      anchorSnapshotRef.current = captureWebTimelineAnchor(
        previousKeys,
        previousOffsetsRef.current,
        root.scrollTop,
      )
    }
    if (wasAtBottom) {
      commitRange(
        calculateWebTimelineRange({
          count: items.length,
          scrollTop: 0,
          viewportHeight: root.clientHeight,
          offsets,
          initialBottom: true,
        }),
      )
    } else if (relocated) {
      commitRange(relocated)
    } else {
      updateRangeFromViewport()
    }
    previousKeysRef.current = keys
    // Reconcile only when the item snapshot changes. Height measurements update
    // spacer math separately and must not repeatedly reset the user's window.
  }, [items, keys])

  useLayoutEffect(() => {
    const root = scrollRootRef.current
    if (!root) return
    const measuredViewport = measuredViewportRef.current
    const anchor = measuredViewport?.anchor ?? anchorSnapshotRef.current
    if (measuredViewport || anchor) {
      const nextScrollTop = measuredViewport
        ? restoreWebTimelineAfterMeasurement({
            followsBottom: measuredViewport.followsBottom,
            scrollHeight: root.scrollHeight,
            keys,
            offsets,
            snapshot: measuredViewport.anchor,
            fallbackScrollTop: root.scrollTop,
          })
        : restoreWebTimelineAnchor(keys, offsets, anchor, root.scrollTop)
      if (Math.abs(nextScrollTop - root.scrollTop) > 0.5) root.scrollTop = nextScrollTop
      measuredViewportRef.current = null
      anchorSnapshotRef.current = null
    }
    previousOffsetsRef.current = offsets
  }, [items, keys, measurementRevision, offsets, range, renderAll, scrollRootRef])

  useEffect(() => {
    const root = scrollRootRef.current
    if (!root || typeof ResizeObserver !== 'function') return
    const observer = new ResizeObserver((entries) => {
      let changed = false
      const followsBottom = followsBottomRef.current
      const anchor = followsBottom
        ? null
        : captureWebTimelineAnchor(keys, offsets, root.scrollTop)
      for (const entry of entries) {
        const node = entry.target as HTMLElement
        const key = node.dataset.webVirtualKey
        const height = entry.contentRect.height
        if (!key || !Number.isFinite(height) || height <= 0) continue
        const previous = measuredHeightsRef.current.get(key)
        if (previous == null || Math.abs(previous - height) > 0.5) {
          measuredHeightsRef.current.set(key, height)
          changed = true
        }
      }
      if (changed) {
        // A followed viewport and an earlier reading position have opposite
        // restoration rules. Keeping an item anchor while the live tail grows
        // briefly pulls the viewport away from the bottom; on Windows Chromium
        // that competing scroll correction is visible as a one-frame flash.
        measuredViewportRef.current = { followsBottom, anchor }
        setMeasurementRevision((value) => value + 1)
      }
    })
    root.querySelectorAll<HTMLElement>('[data-web-virtual-key]').forEach((node) => {
      observer.observe(node)
    })
    return () => observer.disconnect()
  }, [items, keys, offsets, range, renderAll, scrollRootRef])

  const revealIndex = useCallback(
    (rawIndex: number, behavior: ScrollBehavior = 'smooth') => {
      if (items.length === 0) return
      const index = Math.max(0, Math.min(items.length - 1, rawIndex))
      const start = Math.max(0, Math.min(index - 12, items.length - WEB_TIMELINE_MAX_ITEMS))
      commitRange({ start, end: Math.min(items.length, start + WEB_TIMELINE_MAX_ITEMS) })
      void nextPaint().then(() => {
        scrollRootRef.current?.scrollTo({ top: offsets[index], behavior })
      })
    },
    [commitRange, items.length, offsets, scrollRootRef],
  )

  useImperativeHandle(
    ref,
    () => ({
      scrollToIndex: revealIndex,
      scrollToTop: (behavior = 'smooth') => revealIndex(0, behavior),
      scrollToBottom: (behavior = 'smooth') => {
        if (items.length === 0) return
        commitRange({
          start: Math.max(0, items.length - WEB_TIMELINE_MAX_ITEMS),
          end: items.length,
        })
        void nextPaint().then(() => {
          const root = scrollRootRef.current
          root?.scrollTo({ top: root.scrollHeight, behavior })
        })
      },
      withAllItems: async <TResult,>(task: () => Promise<TResult>) => {
        const root = scrollRootRef.current
        const savedRange = rangeRef.current
        const savedScrollTop = root?.scrollTop ?? 0
        setRenderAll(true)
        await nextPaint()
        try {
          return await task()
        } finally {
          setRenderAll(false)
          commitRange(savedRange)
          await nextPaint()
          if (root) root.scrollTop = savedScrollTop
        }
      },
    }),
    [commitRange, items.length, revealIndex, scrollRootRef],
  )

  const boundedRange = renderAll
    ? { start: 0, end: items.length }
    : {
        start: Math.min(range.start, items.length),
        end: Math.min(Math.max(range.end, range.start), items.length),
      }
  const visibleItems = items.slice(boundedRange.start, boundedRange.end)

  return (
    <div className="cwv-messages" style={{ padding: '8px 0 16px' }}>
      {header}
      {!renderAll && boundedRange.start > 0 ? (
        <div
          aria-hidden="true"
          data-web-virtual-spacer="top"
          style={{ height: offsets[boundedRange.start] }}
        />
      ) : null}
      {visibleItems.map((item, visibleIndex) => {
        const index = boundedRange.start + visibleIndex
        return (
          <div key={item.key} data-web-virtual-key={item.key} data-web-virtual-index={index}>
            {renderItem(item, index)}
          </div>
        )
      })}
      {!renderAll && boundedRange.end < items.length ? (
        <div
          aria-hidden="true"
          data-web-virtual-spacer="bottom"
          style={{ height: offsets[items.length] - offsets[boundedRange.end] }}
        />
      ) : null}
      {boundedRange.end === items.length ? footer : null}
    </div>
  )
}

export const VirtualizedWebTimeline = forwardRef(VirtualizedWebTimelineInner) as <
  T extends KeyedItem,
>(
  props: Props<T> & { ref?: React.Ref<WebTimelineHandle> },
) => React.ReactElement
