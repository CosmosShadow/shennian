// @arch docs/features/network-rooms/message-and-attachment-storage.md
// @test ../../__tests__/desktop-room-attachments.test.ts

import Feather from '@expo/vector-icons/Feather'
import { useEffect, useState } from 'react'
import { Image, Modal, Pressable, StyleSheet, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { MessageImageGallery } from '../../components/MessageImageGallery'
import type { Colors } from '../../hooks/useTheme'
import type { PendingRoomAttachment } from '../rooms/useRoomDraftPersistence'
import { createDesktopRoomDraftPreview, type DesktopRoomDraftPreview } from './desktopRoomDraftPreview'

export function DesktopRoomDraftImage({ item, colors }: { item: PendingRoomAttachment; colors: Colors }) {
  const { t } = useTranslation()
  const [preview, setPreview] = useState<DesktopRoomDraftPreview | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let disposed = false
    let resource: DesktopRoomDraftPreview | null = null
    void createDesktopRoomDraftPreview(item).then((value) => {
      if (disposed) {
        value?.release()
        return
      }
      resource = value
      setPreview(value)
    }).catch(() => {
      if (!disposed) setPreview(null)
    })
    return () => {
      disposed = true
      resource?.release()
    }
  }, [item.id, item.file, item.readBytes, item.name, item.mimeType, item.size])

  return <>
    {preview ? (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('spaces_attachment_preview', { name: item.name })}
        onPress={() => setOpen(true)}
        testID={`desktop-room-draft-preview-${item.id}`}
      >
        <Image source={{ uri: preview.uri }} style={styles.thumbnail} onError={() => {
          preview.release()
          setPreview(null)
          setOpen(false)
        }} />
      </Pressable>
    ) : (
      <View style={[styles.fileIcon, { backgroundColor: colors.surfaceHover }]}>
        <Feather name={item.status === 'failed' ? 'alert-circle' : 'file'} size={16}
          color={item.status === 'failed' ? colors.error : colors.textSecondary} />
      </View>
    )}
    {open && preview ? (
      <Modal visible animationType="fade" presentationStyle="fullScreen" onRequestClose={() => setOpen(false)}>
        <MessageImageGallery
          images={[{ key: item.id, name: item.name }]}
          initialIndex={0}
          loadImage={async () => preview.uri}
          onClose={() => setOpen(false)}
          closeIcon="close"
        />
      </Modal>
    ) : null}
  </>
}

const styles = StyleSheet.create({
  thumbnail: { width: 36, height: 36, borderRadius: 7 },
  fileIcon: { width: 36, height: 36, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
})
