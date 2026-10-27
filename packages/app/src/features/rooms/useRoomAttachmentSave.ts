// @arch docs/features/network-rooms/ui.md#46-结构化附件
// @test src/__tests__/room-attachments.test.ts

import { useCallback, useRef, useState } from 'react'
import { downloadFeedback, showDownloadFeedback, type DownloadNotice } from '../../components/DownloadFeedback'
import { useTranslation } from 'react-i18next'
import { downloadRoomAttachment } from './roomAccountAttachments'
import type { RoomDownloadableAttachment } from './roomAttachments'

export function useRoomAttachmentSave(roomId: string, attachment: RoomDownloadableAttachment, localFeedback = false) {
  const { t } = useTranslation()
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<DownloadNotice | null>(null)
  const busy = useRef(false)
  const showNotice = useCallback((next: DownloadNotice | null) => {
    if (localFeedback) setNotice(next)
    else showDownloadFeedback(next)
  }, [localFeedback])

  const save = useCallback(async () => {
    if (busy.current) return
    busy.current = true
    setSaving(true)
    showNotice(null)
    try {
      const result = await downloadRoomAttachment(roomId, attachment)
      showNotice(downloadFeedback(t, result, attachment.name))
    } catch {
      showNotice({ message: t('spaces_attachment_download_failed'), type: 'error' })
    } finally {
      busy.current = false
      setSaving(false)
    }
  }, [attachment, roomId, showNotice, t])

  return { saving, notice, save, hideNotice: () => setNotice(null) }
}
