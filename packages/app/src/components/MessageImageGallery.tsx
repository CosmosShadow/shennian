import { DownloadFeedback, downloadFeedback, type DownloadNotice, type DownloadResult } from './DownloadFeedback'
import { PanResponder } from 'react-native'
import { shouldCloseImageSwipe } from '../features/chat/utils/imageCloseSwipe'
// @arch docs/architecture/app/chat-attachments-preview.md
// @test src/__tests__/image-gallery.test.ts

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { ContainedPreviewImage } from './chat/ContainedPreviewImage'
import { SvgImagePreview } from './chat/SvgImagePreview'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useSafeAreaInsets, type EdgeInsets } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import { ActionIconButton } from './ActionIconButton'
import { HeaderBackButton, HeaderIconButton } from './AppPageHeader'
import { useTheme } from '../hooks/useTheme'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { imagePageIndex } from '../features/chat/utils/imageGallery'

export type GalleryImage = { key: string; name: string; path?: string }
export type GalleryImageResource = string | { uri: string; release(): void }

/** A message-scoped snapshot. Only the current page and its neighbours load image bytes. */
export function MessageImageGallery<T extends GalleryImage>({
  images,
  initialIndex,
  loadImage,
  onDownload,
  onClose,
  closeIcon = 'chevron-back',
  safeAreaInsets,
}: {
  images: T[]
  initialIndex: number
  loadImage: (image: T, signal?: AbortSignal) => Promise<GalleryImageResource>
  onDownload?: (image: T) => Promise<DownloadResult>
  onClose: () => void
  closeIcon?: 'close' | 'chevron-back'
  /** Modal callers must pass insets captured outside the native Modal portal on iOS. */
  safeAreaInsets?: EdgeInsets
}) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const inheritedInsets = useSafeAreaInsets()
  const insets = safeAreaInsets ?? inheritedInsets
  const [index, setIndex] = useState(() => Math.max(0, Math.min(images.length - 1, initialIndex)))
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [zoomed, setZoomed] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState('')
  const [notice, setNotice] = useState<DownloadNotice | null>(null)
  const closeSwipe = PanResponder.create({
    onMoveShouldSetPanResponderCapture: (event, gesture) =>
      !zoomed && event.nativeEvent.touches.length === 1 && shouldCloseImageSwipe(gesture, images.length),
    onPanResponderRelease: (_, gesture) => {
      if (!zoomed && shouldCloseImageSwipe(gesture, images.length)) onClose()
    },
  })
  const downloadBusy = useRef(false)
  const pager = useRef<ScrollView>(null)
  const offsetAtLayout = useRef({ width: 0, height: 0, offset: { x: 0, y: 0 } })
  if (
    offsetAtLayout.current.width !== size.width ||
    offsetAtLayout.current.height !== size.height
  ) {
    offsetAtLayout.current = { ...size, offset: { x: index * size.width, y: 0 } }
  }
  const current = images[index]
  useEscapeKey(true, onClose)

  const selectPage = useCallback(
    (next: number) => {
      if (next < 0 || next >= images.length) return
      setZoomed(false)
      setDownloadError('')
      setIndex(next)
      pager.current?.scrollTo({ x: size.width * next, animated: false })
    },
    [images.length, size.width],
  )

  useEffect(() => {
    if (Platform.OS !== 'web') return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      event.preventDefault()
      selectPage(index + (event.key === 'ArrowLeft' ? -1 : 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, selectPage])

  const download = async () => {
    if (downloadBusy.current || !current || !onDownload) return
    downloadBusy.current = true
    setDownloading(true)
    setDownloadError('')
    try {
      const result = await onDownload(current)
      setNotice(downloadFeedback(t, result, current.name))
    } catch {
      setDownloadError(t('download_failed', { name: current.name }))
    } finally {
      downloadBusy.current = false
      setDownloading(false)
    }
  }

  if (!current) return null

  return (
    <View
      {...closeSwipe.panHandlers}
      style={[
        styles.container,
        {
          backgroundColor: colors.bg,
          paddingTop: insets.top,
          paddingRight: insets.right,
          paddingBottom: insets.bottom,
          paddingLeft: insets.left,
        },
      ]}
    >
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        {closeIcon === 'close' ? (
          <HeaderIconButton icon="close" label={t('close')} onPress={onClose} testID="image-gallery-close" />
        ) : <HeaderBackButton onPress={onClose} testID="image-gallery-close" />}
        <View style={styles.titleWrap}>
          <Text numberOfLines={1} style={[styles.title, { color: colors.text }]}>
            {current.name}
          </Text>
          {current.path ? (
            <Text numberOfLines={1} style={[styles.path, { color: colors.textSecondary }]}>
              {current.path}
            </Text>
          ) : null}
        </View>
        {onDownload ? <Pressable
          style={styles.button}
          onPress={() => void download()}
          disabled={downloading}
          accessibilityRole="button"
          accessibilityLabel={t('download')}
          accessibilityState={{ disabled: downloading }}
          testID="attachment-preview-download"
        >
          {downloading ? (
            <ActivityIndicator color={colors.brand} />
          ) : (
            <Ionicons name="download-outline" size={24} color={colors.text} />
          )}
        </Pressable> : null}
      </View>
      <View
        style={styles.body}
        onLayout={({ nativeEvent: { layout } }) => {
          setSize((prev) =>
            prev.width === layout.width && prev.height === layout.height
              ? prev
              : { width: layout.width, height: layout.height },
          )
        }}
      >
        {size.width > 0 && size.height > 0 ? (
          <ScrollView
            key={`${size.width}:${size.height}`}
            ref={pager}
            horizontal
            pagingEnabled
            style={styles.body}
            contentOffset={offsetAtLayout.current.offset}
            scrollEnabled={!zoomed && images.length > 1}
            directionalLockEnabled
            bounces={false}
            showsHorizontalScrollIndicator={false}
            scrollEventThrottle={16}
            testID="message-image-gallery"
            onScroll={({ nativeEvent }) => {
              const next = imagePageIndex(nativeEvent.contentOffset.x, size.width, images.length)
              if (next !== index) {
                setIndex(next)
                setZoomed(false)
                setDownloadError('')
              }
            }}
          >
            {images.map((image, page) => (
              <View key={image.key} style={{ width: size.width, height: size.height }}>
                {Math.abs(page - index) <= 1 ? (
                  <GalleryPage
                    image={image}
                    loadImage={loadImage}
                    width={size.width}
                    height={size.height}
                    active={page === index}
                    onZoomChange={setZoomed}
                    onClose={onClose}
                  />
                ) : null}
              </View>
            ))}
          </ScrollView>
        ) : null}
      </View>
      <DownloadFeedback notice={notice} onHide={() => setNotice(null)} />
      {downloadError ? (
        <Text accessibilityRole="alert" style={[styles.error, { color: colors.error }]}>
          {downloadError}
        </Text>
      ) : null}
      {images.length > 1 ? (
        <View style={[styles.pagination, { borderTopColor: colors.border }]}>
          <ActionIconButton icon="back" label={t('image_gallery_previous')}
            disabled={index === 0} onPress={() => selectPage(index - 1)}
            testID="image-gallery-previous" />
          <Text
            style={[styles.counter, { color: colors.textSecondary }]}
            accessibilityLiveRegion="polite"
            accessibilityLabel={t('image_gallery_position', {
              current: index + 1,
              total: images.length,
            })}
            testID="image-gallery-position"
          >
            {index + 1} / {images.length}
          </Text>
          <ActionIconButton icon="chevron-forward" label={t('image_gallery_next')}
            disabled={index === images.length - 1} onPress={() => selectPage(index + 1)}
            testID="image-gallery-next" />
        </View>
      ) : null}
    </View>
  )
}

function GalleryPage<T extends GalleryImage>({
  image,
  loadImage,
  width,
  height,
  active,
  onZoomChange,
  onClose,
}: {
  image: T
  loadImage: (image: T, signal?: AbortSignal) => Promise<GalleryImageResource>
  width: number
  height: number
  active: boolean
  onZoomChange: (zoomed: boolean) => void
  onClose: () => void
}) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const [uri, setUri] = useState<string | null>(null)
  const [panningZoomedImage, setPanningZoomedImage] = useState(false)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    setPanningZoomedImage(false)
    if (active) onZoomChange(false)
  }, [active, width, height, onZoomChange])
  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    let resource: GalleryImageResource | undefined
    setUri(null)
    setFailed(false)
    void loadImage(image, controller.signal)
      .then((value) => {
        resource = value
        if (cancelled) { if (typeof value !== 'string') value.release() }
        else setUri(typeof value === 'string' ? value : value.uri)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
      controller.abort()
      if (resource && typeof resource !== 'string') resource.release()
    }
  }, [image, loadImage, attempt])

  if (failed)
    return (
      <Pressable
        style={styles.state}
        onPress={() => setAttempt((value) => value + 1)}
        accessibilityRole="button"
        accessibilityLabel={t('retry')}
      >
        <Ionicons name="refresh" size={24} color={colors.textSecondary} />
        <Text style={{ color: colors.textSecondary }}>{t('spaces_attachment_preview_failed')}</Text>
      </Pressable>
    )
  if (!uri)
    return (
      <View style={styles.state}>
        <ActivityIndicator color={colors.brand} accessibilityLabel={t('loading')} />
      </View>
    )
  if (
    /\.svg(?:[?#]|$)/i.test(image.name) ||
    /\.svg(?:[?#]|$)/i.test(uri) ||
    /^data:image\/svg\+xml[;,]/i.test(uri)
  ) {
    return <SvgImagePreview uri={uri} label={image.name} />
  }
  return (
    <ScrollView
      key={`${active}:${attempt}:${width}:${height}`}
      style={styles.body}
      contentContainerStyle={{ width, height }}
      contentInsetAdjustmentBehavior="never"
      automaticallyAdjustContentInsets={false}
      maximumZoomScale={5}
      minimumZoomScale={1}
      scrollEnabled={panningZoomedImage}
      pinchGestureEnabled
      bounces={false}
      bouncesZoom
      directionalLockEnabled
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
      scrollEventThrottle={16}
      onScroll={({ nativeEvent }) => {
        const zoomed = (nativeEvent.zoomScale ?? 1) > 1.01
        setPanningZoomedImage(zoomed)
        if (active) onZoomChange(zoomed)
      }}
    >
      <ContainedPreviewImage
        uri={uri}
        width={width}
        height={height}
        zoomed={panningZoomedImage}
        onBackdropPress={active ? onClose : undefined}
        accessibilityLabel={image.name}
        onError={() => setFailed(true)}
      />
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, minHeight: 0 },
  header: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  button: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  titleWrap: { flex: 1, minWidth: 0 },
  title: { fontSize: 17, fontWeight: '600' },
  path: { fontSize: 12, marginTop: 2 },
  body: { flex: 1, minHeight: 0 },
  state: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16 },
  pagination: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 24,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  counter: { fontSize: 13, minWidth: 48, textAlign: 'center' },
  error: { fontSize: 13, padding: 12, textAlign: 'center' },
})
