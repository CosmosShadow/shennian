// @arch docs/architecture/interactive-web-agent-and-versioning.md
// @test src/__tests__/interactive-content-session.test.ts
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { Animated, StyleSheet, View } from 'react-native'
import type { Ref } from 'react'
import { ContentCanvas } from './ContentCanvas'
import type { ContentDocument } from './contentSession'
import type { ContentCanvasHandle, ContentSaveMetadata } from './contentRuntimeTypes'

export type ContentPagerHandle = { begin(): void; move(dx: number): void; finish(direction: -1 | 1 | null): void }
/** Small explicit motion state machine, separate from content persistence and native timing. */
export function createContentSwipeController(io: {
  extent(): number; ready(direction: -1 | 1): string | null; set(value: number): void; stop(): void
  animate(to: number, done: (finished: boolean) => void): void
  navigate(direction: -1 | 1, expectedWorkId: string): Promise<boolean>
}) {
  let dragging = false, moving = false, epoch = 0, alive = true
  const reset = () => { epoch++; dragging = false; moving = false; io.stop(); io.set(0) }
  const home = () => { const token = ++epoch; moving = true; io.animate(0, () => { if (alive && token === epoch) { moving = false; io.set(0) } }) }
  return {
    begin() { if (alive && !moving) dragging = true },
    move(dx: number) {
      if (!alive || !dragging || moving) return
      const bounded = Math.max(-io.extent(), Math.min(io.extent(), dx))
      io.set(io.ready(dx < 0 ? 1 : -1) ? bounded : bounded * 0.12)
    },
    finish(direction: -1 | 1 | null) {
      if (!alive || !dragging || moving) return
      dragging = false
      const target = direction && io.ready(direction)
      if (!direction || !target) { home(); return }
      const token = ++epoch
      moving = true
      io.animate(-direction * io.extent(), (finished) => {
        if (!alive || token !== epoch) return
        if (!finished) { home(); return }
        void io.navigate(direction, target).then((changed) => {
          // A successful navigation resets motion in layout, before the next frame.
          if (alive && token === epoch && !changed) home()
        }, () => { if (alive && token === epoch) home() })
      })
    },
    reset,
    dispose() { alive = false; reset() },
  }
}

type Props = {
  document: ContentDocument | null
  previous?: ContentDocument
  next?: ContentDocument
  canvasRef?: Ref<ContentCanvasHandle>
  onPage(direction: -1 | 1, expectedWorkId: string): Promise<boolean>
  onIntent?(text: string): void
  onSave?(html: string, metadata?: ContentSaveMetadata): void
  onPaint?(): void
}
export const contentSurfaceKey = (document: ContentDocument) => `${document.workId}:${document.versionId}:${document.headRevision}`
const key = contentSurfaceKey
/** Keep surfaces in world coordinates: changing focus must not move a painted WebView. */
export function contentPageSlots(previous: Map<string, number>, current: string, keys: Array<{ id: string; offset: number }>) {
  const center = previous.get(current) ?? 0
  return new Map(keys.map(({ id, offset }) => [id, center + offset]))
}
/** Three bounded, real WebViews. Only the selected surface owns input/voice/native operations. */
export const ContentPager = forwardRef<ContentPagerHandle, Props>(function ContentPager(props, ref) {
  const [height, setHeight] = useState(0)
  const position = useRef(new Animated.Value(0)).current
  const slots = useRef(new Map<string, number>())
  const version = props.document ? key(props.document) : ''
  const pages = [{ document: props.previous, offset: -1 }, { document: props.document, offset: 0 }, { document: props.next, offset: 1 }]
    .filter((item): item is { document: ContentDocument; offset: number } => Boolean(item.document))
  slots.current = contentPageSlots(slots.current, version, pages.map(({ document, offset }) => ({ id: key(document), offset })))
  const base = -(slots.current.get(version) ?? 0) * height
  const live = useRef({ ...props, height, base }); live.current = { ...props, height, base }
  const painted = useRef(new Set<string>())
  const motion = useRef<ReturnType<typeof createContentSwipeController> | null>(null)
  if (!motion.current) motion.current = createContentSwipeController({
    extent: () => live.current.height,
    ready: (direction) => {
      const doc = direction === -1 ? live.current.previous : live.current.next
      return live.current.height > 0 && doc && painted.current.has(key(doc)) ? doc.workId : null
    },
    set: (value) => position.setValue(live.current.base + value), stop: () => position.stopAnimation(),
    animate: (toValue, done) => Animated.timing(position, { toValue: live.current.base + toValue, duration: 220, useNativeDriver: true }).start(({ finished }) => done(finished)),
    navigate: (direction, target) => live.current.onPage(direction, target),
  })
  useImperativeHandle(ref, () => motion.current!, [])
  useLayoutEffect(() => { motion.current?.reset() }, [version, height])
  useEffect(() => { if (props.document && painted.current.has(version)) live.current.onPaint?.() }, [version])
  useEffect(() => () => { motion.current?.dispose() }, [])
  const retained = new Set(pages.map((item) => key(item.document)))
  for (const id of painted.current) if (!retained.has(id)) painted.current.delete(id)
  return <View testID="interactive-content-pager" style={styles.root} onLayout={(event) => setHeight(event.nativeEvent.layout.height)}>
    <Animated.View style={[styles.track, { transform: [{ translateY: position }] }]}>
      {pages.map(({ document, offset }) => {
        const active = offset === 0
        return <View key={key(document)} testID={active ? 'interactive-content-page-current' : offset < 0 ? 'interactive-content-page-previous' : 'interactive-content-page-next'}
          pointerEvents={active ? 'auto' : 'none'} accessibilityElementsHidden={!active} importantForAccessibility={active ? 'auto' : 'no-hide-descendants'}
          style={[styles.page, { top: (slots.current.get(key(document)) ?? 0) * height, height: height || '100%' }]}>
          <ContentCanvas document={document} safeArea={{ top: 68, bottom: 12 }} active={active} ref={active ? props.canvasRef : undefined}
            onIntent={props.onIntent} onSave={props.onSave} onPaint={() => {
              painted.current.add(key(document))
              if (live.current.document && key(live.current.document) === key(document)) live.current.onPaint?.()
            }} />
        </View>
      })}
    </Animated.View>
  </View>
})
const styles = StyleSheet.create({ root: { flex: 1, overflow: 'hidden' }, track: { flex: 1 }, page: { position: 'absolute', left: 0, right: 0 } })
