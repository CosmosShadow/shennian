// @arch docs/architecture/app/chat-attachments-preview.md#同一消息多图浏览
// @test src/__tests__/image-gallery.test.ts

import { useRef, useState } from 'react'
import { Image, View, type ImageProps, type GestureResponderEvent } from 'react-native'
import { createImageBackdropTap, isImageBackdrop } from '../../features/chat/utils/imageBackdropTap'

/** Shared raster image hit testing for single-image previews and message galleries. */
export function ContainedPreviewImage({
  uri,
  width,
  height,
  zoomed = false,
  onBackdropPress,
  onError,
  accessibilityLabel,
}: {
  uri: string
  width: number
  height: number
  zoomed?: boolean
  onBackdropPress?: () => void
  onError?: ImageProps['onError']
  accessibilityLabel?: string
}) {
  const [loaded, setLoaded] = useState<{ uri: string; width: number; height: number } | null>(null)
  const tap = useRef(createImageBackdropTap()).current
  const geometry = `${uri}:${width}:${height}:${zoomed}`
  const previousGeometry = useRef(geometry)
  if (previousGeometry.current !== geometry) {
    tap.cancel()
    previousGeometry.current = geometry
  }
  const eligible = (event: GestureResponderEvent) =>
    !!onBackdropPress &&
    !zoomed &&
    loaded?.uri === uri &&
    isImageBackdrop(
      { x: event.nativeEvent.locationX, y: event.nativeEvent.locationY },
      { width, height },
      loaded,
    )
  return (
    <View
      style={{ width, height }}
      onTouchStart={(event) =>
        tap.start(event.nativeEvent, event.nativeEvent.touches.length, eligible(event))
      }
      onTouchMove={(event) => tap.move(event.nativeEvent, event.nativeEvent.touches.length)}
      onTouchCancel={() => tap.cancel()}
      onTouchEnd={(event) => {
        if (tap.end(event.nativeEvent, event.nativeEvent.touches.length, eligible(event)))
          onBackdropPress?.()
      }}
    >
      <Image
        source={{ uri }}
        style={{ width, height }}
        resizeMode="contain"
        accessibilityLabel={accessibilityLabel}
        onLoad={(event) => {
          const source = event.nativeEvent?.source
          const image = event.target as typeof event.target & {
            naturalWidth?: number
            naturalHeight?: number
          }
          const imageWidth = source?.width ?? image?.naturalWidth
          const imageHeight = source?.height ?? image?.naturalHeight
          if (imageWidth && imageHeight) setLoaded({ uri, width: imageWidth, height: imageHeight })
        }}
        onError={(event) => {
          setLoaded(null)
          tap.cancel()
          onError?.(event)
        }}
      />
    </View>
  )
}
