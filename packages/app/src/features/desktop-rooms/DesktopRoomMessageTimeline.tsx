// @arch docs/features/desktop-local-first-client.md#7-信息架构
// @test src/__tests__/desktop-room-public-conversation.test.ts
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, type ReactNode } from 'react'
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native'
import type { RoomMessageView } from '@shennian/wire'
import { VirtualizedWebTimeline } from '../../components/chat/webTimelineVirtualization'

export type DesktopRoomTimelineHandle = {
  // Preserve the existing saved distance-from-bottom contract across this migration.
  scrollToOffset(options: { offset: number; animated: boolean }): void
}
type Props = {
  data: RoomMessageView[]
  renderItem(info: { item: RoomMessageView; index: number }): ReactNode
  onScroll(event: NativeSyntheticEvent<NativeScrollEvent>): void
  ListEmptyComponent: ReactNode
  ListFooterComponent: ReactNode
  ListEndComponent?: ReactNode
}
const estimateHeight = ({ message }: { message: RoomMessageView }) =>
  Math.max(90, Math.min(1800, 70 + Math.ceil((message.text?.length ?? 0) / 38) * 24 + (message.attachments?.length ?? 0) * 180))

/** A normal native scroller: no inverted transforms, wheel handlers or preventDefault. */
export const DesktopRoomMessageTimeline = forwardRef<DesktopRoomTimelineHandle, Props>(function DesktopRoomMessageTimeline(props, ref) {
  const rootRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const latest = useRef(props)
  latest.current = props
  const pendingOffset = useRef<number | null>(0)
  const followsLatest = useRef(true)
  const frame = useRef(0)
  const measured = useRef(false)
  const items = useMemo(() => props.data.map((message, index) => ({ key: message.id, message, originalIndex: index })).reverse(), [props.data])
  useImperativeHandle(ref, () => ({
    scrollToOffset({ offset, animated }) {
      const root = rootRef.current
      pendingOffset.current = offset
      followsLatest.current = offset < 120
      if (!root) return
      root.scrollTo({ top: Math.max(0, root.scrollHeight - root.clientHeight - offset), behavior: animated ? 'smooth' : 'instant' })
      // ResizeObserver applies non-animated restoration after initial measurement.
      if (animated || measured.current) pendingOffset.current = null
    },
  }), [])
  useEffect(() => {
    const root = rootRef.current
    const content = contentRef.current
    if (!root || !content) return
    const onScroll = () => {
      const distance = Math.max(0, root.scrollHeight - root.clientHeight - root.scrollTop)
      followsLatest.current = distance < 120
      if (frame.current) return
      frame.current = requestAnimationFrame(() => {
        frame.current = 0
        const offset = Math.max(0, root.scrollHeight - root.clientHeight - root.scrollTop)
        latest.current.onScroll({ nativeEvent: {
          contentOffset: { x: 0, y: offset },
          contentSize: { width: root.clientWidth, height: root.scrollHeight },
          layoutMeasurement: { width: root.clientWidth, height: root.clientHeight },
        } } as NativeSyntheticEvent<NativeScrollEvent>)
      })
    }
    const observer = new ResizeObserver(() => {
      measured.current = true
      const offset = pendingOffset.current
      if (offset !== null || followsLatest.current) {
        const top = Math.max(0, root.scrollHeight - root.clientHeight - (offset ?? 0))
        if (Math.abs(top - root.scrollTop) > .5) root.scrollTop = top
        pendingOffset.current = null
      }
    })
    observer.observe(root)
    observer.observe(content)
    root.addEventListener('scroll', onScroll, { passive: true })
    return () => { observer.disconnect(); root.removeEventListener('scroll', onScroll); cancelAnimationFrame(frame.current) }
  }, [])
  return <div ref={rootRef} data-testid="desktop-room-public-messages"
    style={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehaviorY: 'contain', overflowAnchor: 'none' }}>
    <div ref={contentRef} style={{ minHeight: '100%', maxWidth: 860, margin: '0 auto', padding: '0 18px 14px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
      {items.length === 0 ? props.ListEmptyComponent : <VirtualizedWebTimeline
        items={items} scrollRootRef={rootRef} estimateHeight={estimateHeight}
        header={props.ListFooterComponent}
        footer={props.ListEndComponent}
        renderItem={item => <div style={{ paddingBottom: 20 }}>{props.renderItem({ item: item.message, index: item.originalIndex })}</div>} />}
    </div>
  </div>
})
