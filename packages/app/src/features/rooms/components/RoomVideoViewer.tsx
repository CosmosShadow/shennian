import { DownloadFeedback } from '../../../components/DownloadFeedback'
// @arch docs/features/network-rooms/ui.md#46-结构化附件
// @test src/__tests__/room-conversation-screen.test.ts

import { useEffect, useState } from 'react'
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { WebView } from 'react-native-webview'
import { useTranslation } from 'react-i18next'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { RoomMessageView } from '@shennian/wire'
import { useTheme } from '../../../hooks/useTheme'
import { mobileTypography } from '../../../theme/mobileTypography'
import { getRoomAttachmentDownloadUrl } from '../roomAccountAttachments'
import { useRoomAttachmentSave } from '../useRoomAttachmentSave'

export const canPreviewRoomVideo = true

const escapeAttribute = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

export function RoomVideoViewer({ roomId, attachment, onClose }: {
  roomId: string
  attachment: RoomMessageView['attachments'][number]
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  // The native Modal lives in a separate view hierarchy on iOS, so capture insets before entering it.
  const insets = useSafeAreaInsets()
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const { saving, notice, save, hideNotice } = useRoomAttachmentSave(roomId, attachment, true)

  useEffect(() => {
    let active = true
    setUrl(null)
    setFailed(false)
    getRoomAttachmentDownloadUrl(roomId, attachment.attachmentId)
      .then((value) => { if (active) setUrl(value) })
      .catch(() => { if (active) setFailed(true) })
    return () => { active = false }
  }, [attachment.attachmentId, roomId])

  // A <video> element plays through the system player and ignores Content-Disposition, which a
  // direct navigation to the signed URL would not.
  const html = url ? `<!doctype html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{margin:0;width:100%;height:100%;background:#000}video{width:100%;height:100%;object-fit:contain}</style>
</head><body><video src="${escapeAttribute(url)}" controls autoplay playsinline></video></body></html>` : null

  return (
    <Modal visible animationType="fade" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={[styles.container, { backgroundColor: colors.bg, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('close')} style={styles.button} onPress={onClose}>
            <Ionicons name="close" size={24} color={colors.text} />
          </Pressable>
          <View style={styles.titleWrap}>
            <Text numberOfLines={1} style={[styles.title, { color: colors.text }]}>{attachment.name}</Text>

          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('spaces_attachment_download', { name: attachment.name })}
            disabled={saving}
            style={styles.button}
            onPress={() => void save()}
          >
            {saving
              ? <ActivityIndicator size="small" color={colors.brand} />
              : <Ionicons name="download-outline" size={22} color={colors.text} />}
          </Pressable>
        </View>
        <View style={styles.body}>
          {html ? (
            <WebView
              source={{ html, baseUrl: 'about:blank' }}
              originWhitelist={['about:blank', 'https://*']}
              allowsInlineMediaPlayback
              mediaPlaybackRequiresUserAction={false}
              onError={() => setFailed(true)}
              onHttpError={() => setFailed(true)}
              style={styles.web}
              containerStyle={styles.web}
            />
          ) : failed ? null : <ActivityIndicator color="#fff" />}
          {failed ? <Text style={styles.failed}>{t('spaces_video_preview_failed')}</Text> : null}
        </View>
        <DownloadFeedback notice={notice} onHide={hideNotice} />
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  button: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  titleWrap: { flex: 1, minWidth: 0, paddingHorizontal: 4 },
  title: { ...mobileTypography.secondary, fontWeight: '600' },
  notice: { ...mobileTypography.metadata, marginTop: 1 },
  body: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  web: { flex: 1, alignSelf: 'stretch', backgroundColor: '#000' },
  failed: { color: '#fff', fontSize: 14, paddingHorizontal: 24, textAlign: 'center' },
})
