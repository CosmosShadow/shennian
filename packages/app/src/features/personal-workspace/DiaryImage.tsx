// @arch docs/features/personal-agent-workspace.md
// @test src/__tests__/diary-image.test.ts
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Image, Modal, Pressable, Text, View, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { MessageImageGallery } from '../../components/MessageImageGallery'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../hooks/useTheme'
import { ensureImageAttachmentPreview } from '../chat/utils/attachmentPreview'
import { SvgImagePreview } from '../../components/chat/SvgImagePreview'
import { diaryImageAttachment } from './diaryImageSource'

export function DiaryImage({ src, alt, machineId, directory, path }: {
  src: string; alt?: string; machineId?: string; directory?: string; path: string
}) {
  const { t } = useTranslation(), { colors } = useTheme(), { width } = useWindowDimensions()
  const safeAreaInsets = useSafeAreaInsets()
  const key = JSON.stringify([machineId, directory, path, src])
  const [loaded, setLoaded] = useState<{ key: string; uri: string | null } | null>(null)
  const [failedKey, setFailedKey] = useState<string | null>(null)
  const [dimensions, setDimensions] = useState<{ key: string; ratio: number } | null>(null)
  const [layoutWidth, setLayoutWidth] = useState(width - 48)
  const [openedKey, setOpenedKey] = useState<string | null>(null)
  const uri = loaded?.key === key ? loaded.uri : null
  const images = useMemo(() => [{ key, name: alt || src }], [key, alt, src])
  const loadImage = useCallback(async () => {
    if (!uri) throw new Error('Image unavailable')
    return uri
  }, [uri])
  useEffect(() => {
    let live = true
    const image = diaryImageAttachment(src, directory, path)
    const request = machineId && image ? ensureImageAttachmentPreview(machineId, image) : Promise.resolve(null)
    void request.then(uri => { if (live) setLoaded({ key, uri }) }).catch(() => { if (live) setLoaded({ key, uri: null }) })
    return () => { live = false }
  }, [key, src, directory, path, machineId])
  const current = loaded?.key === key ? loaded : null
  if (failedKey === key || (current && !current.uri)) return <Text style={{ color: colors.textSecondary }}>{alt ? `${alt} · ` : ''}{t('personal_image_not_loaded')}</Text>
  if (!current?.uri) return <ActivityIndicator color={colors.brand} style={{ marginVertical: 12 }} />
  const style = { width: '100%' as const, height: layoutWidth / (dimensions?.key === key ? dimensions.ratio : 1) }
  const close = () => setOpenedKey(null)
  return <View style={{ width: '100%', marginVertical: 8 }} onLayout={event => {
    const next = event.nativeEvent.layout.width
    if (next > 0) setLayoutWidth(next)
  }}>
    <Pressable accessibilityRole="button" accessibilityLabel={alt || src} onPress={() => setOpenedKey(key)}>
      {/\.svg$/i.test(src) ? <View style={style}><SvgImagePreview uri={current.uri} label={alt || src} /></View>
        : <Image source={{ uri: current.uri }} accessibilityLabel={alt} resizeMode="contain" style={style}
          onLoad={({ nativeEvent: { source } }) => {
            if (source.width > 0 && source.height > 0) setDimensions({ key, ratio: source.width / source.height })
          }} onError={() => setFailedKey(key)} />}
    </Pressable>
    {openedKey === key ? <Modal visible animationType="fade" presentationStyle="fullScreen" onRequestClose={close}>
      <MessageImageGallery images={images} initialIndex={0} loadImage={loadImage} onClose={close} closeIcon="close" safeAreaInsets={safeAreaInsets} />
    </Modal> : null}
  </View>
}
