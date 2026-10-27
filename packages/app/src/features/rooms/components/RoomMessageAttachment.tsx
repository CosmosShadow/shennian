// @arch docs/features/network-rooms/ui.md#54-消息
// @test src/__tests__/room-conversation-screen.test.ts

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useTranslation } from 'react-i18next'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { MessageImageGallery, type GalleryImageResource } from '../../../components/MessageImageGallery'
import type { RoomMessageView } from '@shennian/wire'
import { useTheme } from '../../../hooks/useTheme'
import { mobileTypography } from '../../../theme/mobileTypography'
import {
  isRoomVideoAttachment,
  roomAttachmentExpiryKind,
  splitAttachmentName,
} from '../roomPresentation'
import {
  downloadRoomAttachment,
  loadRoomAttachmentPreview,
} from '../roomAccountAttachments'
import { useRoomAttachmentSave } from '../useRoomAttachmentSave'
import { canPreviewRoomVideo, RoomVideoViewer } from './RoomVideoViewer'

type Attachment = RoomMessageView['attachments'][number]

export function RoomMessageAttachment({
  roomId,
  attachment,
  attachments,
}: {
  roomId: string
  attachment: Attachment
  attachments?: Attachment[]
}) {
  const expiryKind = roomAttachmentExpiryKind(attachment)
  if (expiryKind) return <RoomExpiredAttachment kind={expiryKind} />
  if (attachment.mediaKind === 'image') {
    return <RoomInlineImage roomId={roomId} attachment={attachment} attachments={attachments ?? [attachment]} />
  }
  return <RoomDownloadCard roomId={roomId} attachment={attachment} />
}

function RoomExpiredAttachment({ kind }: { kind: 'image' | 'attachment' }) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  return (
    <View
      accessibilityRole="text"
      testID={`room-${kind}-attachment-expired`}
      style={[styles.expiredCard, { backgroundColor: colors.surfaceHover }]}
    >
      <Ionicons
        name={kind === 'image' ? 'image-outline' : 'document-outline'}
        size={20}
        color={colors.textSecondary}
      />
      <Text style={[styles.expiredText, { color: colors.textSecondary }]}>
        {t(kind === 'image' ? 'spaces_image_expired' : 'spaces_attachment_expired')}
      </Text>
    </View>
  )
}

function RoomInlineImage({ roomId, attachment, attachments }: { roomId: string; attachment: Attachment; attachments: Attachment[] }) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const [attempt, setAttempt] = useState(0)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [viewerOpen, setViewerOpen] = useState(false)
  const [viewerImages, setViewerImages] = useState<Attachment[]>([])

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    let resource: GalleryImageResource | undefined
    setPreviewUrl(null)
    setFailed(false)
    void loadRoomAttachmentPreview(roomId, attachment.attachmentId, controller.signal)
      .then((value: GalleryImageResource) => {
        resource = value
        if (active) setPreviewUrl(typeof value === 'string' ? value : value.uri)
        else if (typeof value !== 'string') value.release()
      })
      .catch(() => {
        if (active) setFailed(true)
      })
    return () => {
      active = false
      controller.abort()
      if (resource && typeof resource !== 'string') resource.release()
    }
  }, [attachment.attachmentId, attempt, roomId])

  const openViewer = useCallback(() => {
    setViewerImages(attachments.filter(
      (item) => item.mediaKind === 'image' && !roomAttachmentExpiryKind(item),
    ))
    setViewerOpen(true)
  }, [attachments])

  return (
    <View
      testID={`room-image-attachment-${attachment.attachmentId}`}
      style={styles.imageCard}
    >
      {previewUrl && !failed ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('spaces_attachment_preview', { name: attachment.name })}
          onPress={openViewer}
        >
          <Image
            source={{ uri: previewUrl }}
            style={styles.image}
            resizeMode="contain"
            accessibilityLabel={attachment.name}
            onError={() => setFailed(true)}
          />
        </Pressable>
      ) : failed ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('retry')}
          style={[styles.imageState, { backgroundColor: colors.surfaceHover }]}
          onPress={() => setAttempt((value) => value + 1)}
        >
          <Ionicons name="refresh" size={20} color={colors.textSecondary} />
          <Text
            style={[styles.stateText, { color: colors.textSecondary }]}
          >
            {t('spaces_attachment_preview_failed')}
          </Text>
        </Pressable>
      ) : (
        <View style={[styles.imageState, { backgroundColor: colors.surfaceHover }]}>
          <ActivityIndicator size="small" color={colors.brand} />
        </View>
      )}
      {viewerOpen ? <RoomImageViewer
        roomId={roomId}
        attachment={attachment}
        images={viewerImages}
        onClose={() => setViewerOpen(false)}
      /> : null}
    </View>
  )
}

function RoomImageViewer({ roomId, attachment, images, onClose }: {
  roomId: string
  attachment: Attachment
  images: Attachment[]
  onClose: () => void
}) {
  // A native full-screen Modal is hosted in a separate view hierarchy on iOS.
  // Capture the provider value before entering it instead of asking the portal for insets.
  const safeAreaInsets = useSafeAreaInsets()
  const items = useMemo(() => images.map((image) => ({ ...image, key: image.attachmentId })), [images])
  const loadImage = useCallback((image: Attachment, signal?: AbortSignal) =>
    loadRoomAttachmentPreview(roomId, image.attachmentId, signal), [roomId])
  const download = useCallback((image: Attachment) => downloadRoomAttachment(roomId, image), [roomId])
  return (
    <Modal visible animationType="fade" presentationStyle="fullScreen" onRequestClose={onClose}>
      <MessageImageGallery images={items}
        initialIndex={images.findIndex((image) => image.attachmentId === attachment.attachmentId)}
        loadImage={loadImage} onDownload={download} onClose={onClose} closeIcon="close"
        safeAreaInsets={safeAreaInsets} />
    </Modal>
  )
}

function RoomDownloadCard({ roomId, attachment }: { roomId: string; attachment: Attachment }) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const { saving, save } = useRoomAttachmentSave(roomId, attachment)
  const [viewerOpen, setViewerOpen] = useState(false)
  const isVideo = isRoomVideoAttachment(attachment)
  const previewable = isVideo && canPreviewRoomVideo
  const { stem, ext } = splitAttachmentName(attachment.name)

  return (
    <View
      testID={`room-file-attachment-${attachment.attachmentId}`}
      style={[styles.fileCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <Pressable
        accessibilityRole={previewable ? 'button' : undefined}
        accessibilityLabel={previewable ? t('spaces_video_preview', { name: attachment.name }) : undefined}
        disabled={!previewable}
        onPress={() => setViewerOpen(true)}
        style={styles.fileMain}
      >
        <Ionicons
          name={isVideo ? 'videocam-outline' : attachment.mediaKind === 'audio' ? 'musical-notes-outline' : 'document-outline'}
          size={22}
          color={colors.brand}
        />
        <View style={styles.fileText}>
          {/* The stem ellipsizes; the extension never shrinks so the file type stays visible. */}
          <View style={styles.nameRow}>
            <Text numberOfLines={1} style={[styles.name, styles.nameStem, { color: colors.text }]}>{stem}</Text>
            {ext ? <Text numberOfLines={1} style={[styles.name, styles.nameExt, { color: colors.text }]}>{ext}</Text> : null}
          </View>
          <Text numberOfLines={2} style={[styles.meta, { color: colors.textTertiary }]}>{formatBytes(attachment.byteSize)}</Text>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('spaces_attachment_download', { name: attachment.name })}
        disabled={saving}
        onPress={() => void save()}
        style={[styles.downloadButton, { backgroundColor: colors.brandLight }]}
      >
        {saving ? (
          <ActivityIndicator size="small" color={colors.brand} />
        ) : (
          <Ionicons name="download-outline" size={18} color={colors.brand} />
        )}
      </Pressable>
      {viewerOpen ? (
        <RoomVideoViewer roomId={roomId} attachment={attachment} onClose={() => setViewerOpen(false)} />
      ) : null}
    </View>
  )
}

function formatBytes(value: string): string {
  const bytes = Number(value)
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const styles = StyleSheet.create({
  imageCard: {
    width: 240,
    maxWidth: '100%',
    overflow: 'hidden',
    borderRadius: 12,
  },
  image: { width: '100%', height: 176, borderRadius: 12 },
  expiredCard: {
    minWidth: 180,
    minHeight: 48,
    paddingHorizontal: 12,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  expiredText: { fontSize: 13, ...(Platform.OS !== 'web' && mobileTypography.metadata) },
  imageState: {
    width: '100%',
    height: 176,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 12,
  },
  stateText: { fontSize: 11, ...(Platform.OS !== 'web' && mobileTypography.metadata) },
  fileCard: {
    width: 300,
    maxWidth: '100%',
    minHeight: 58,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  fileMain: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 9 },
  fileText: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'baseline' },
  nameStem: { flexShrink: 1 },
  nameExt: { flexShrink: 0 },
  name: { fontSize: 12, lineHeight: 16, fontWeight: '600', ...(Platform.OS !== 'web' && mobileTypography.secondary) },
  meta: { fontSize: 10, lineHeight: 14, marginTop: 1, ...(Platform.OS !== 'web' && mobileTypography.metadata) },
  downloadButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
