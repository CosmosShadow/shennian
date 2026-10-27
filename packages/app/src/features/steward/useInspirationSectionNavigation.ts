// @arch docs/architecture/mobile-navigation.md
// @test src/__tests__/inspiration-sections.test.ts
import { useEffect, useRef, useState } from 'react'
import { ScrollView, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native'
import {
  inspirationSectionAtScroll,
  inspirationSectionTarget,
  inspirationSections,
} from './inspirationSections'

export function useInspirationSectionNavigation(open: boolean) {
  const bodyRef = useRef<ScrollView>(null)
  const tagsRef = useRef<ScrollView>(null)
  const anchors = useRef<number[]>(inspirationSections.map(() => Infinity))
  const tagOffsets = useRef<number[]>([])
  const stickyHeight = useRef(0)
  const pendingTarget = useRef<number | null>(null)
  const [active, setActive] = useState(0)
  useEffect(() => {
    if (!open) return
    pendingTarget.current = null
    setActive(0)
    bodyRef.current?.scrollTo({ y: 0, animated: false })
    tagsRef.current?.scrollTo({ x: 0, animated: false })
  }, [open])
  useEffect(() => {
    tagsRef.current?.scrollTo({
      x: Math.max(0, (tagOffsets.current[active] ?? 0) - 8),
      animated: true,
    })
  }, [active])
  const onScroll = ({ nativeEvent: event }: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offset = Math.max(0, event.contentOffset.y)
    if (pendingTarget.current !== null) {
      const maxOffset = Math.max(0, event.contentSize.height - event.layoutMeasurement.height)
      const effectiveTarget = Math.min(pendingTarget.current, maxOffset)
      if (Math.abs(offset - effectiveTarget) > 2) return
      pendingTarget.current = null
    }
    setActive(
      inspirationSectionAtScroll(
        anchors.current,
        offset,
        stickyHeight.current,
        event.contentSize.height,
        event.layoutMeasurement.height,
      ),
    )
  }
  const selectSection = (index: number) => {
    const y = anchors.current[index]
    if (!Number.isFinite(y)) return
    const target = inspirationSectionTarget(y, stickyHeight.current)
    pendingTarget.current = target
    setActive(index)
    bodyRef.current?.scrollTo({ y: target, animated: true })
  }
  return {
    bodyRef,
    tagsRef,
    active,
    selectSection,
    onSectionLayout: (index: number, y: number) => {
      anchors.current[index] = y
    },
    onTagLayout: (index: number, x: number) => {
      tagOffsets.current[index] = x
    },
    onTagsLayout: (height: number) => {
      stickyHeight.current = height
    },
    scrollProps: {
      stickyHeaderIndices: [0],
      scrollEventThrottle: 16,
      onScroll,
      onScrollBeginDrag: () => {
        pendingTarget.current = null
      },
      onMomentumScrollEnd: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
        pendingTarget.current = null
        onScroll(event)
      },
    },
  }
}
