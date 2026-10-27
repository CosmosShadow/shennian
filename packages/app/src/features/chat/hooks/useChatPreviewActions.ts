import { diaryLinkDate } from '../../personal-workspace/diaryLink'
import { downloadFeedback } from '../../../components/downloadFeedbackPolicy'
// @arch docs/architecture/app/modular-features.md#聊天-feature
// @test src/__tests__/chat-screen-utils.test.ts

import { useCallback, type RefObject } from 'react'
import { Alert, Platform, Share } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import * as FileSystemLegacy from 'expo-file-system/legacy'
import type { ChatAttachmentMeta } from '@shennian/wire'
import type { ChatWebViewHandle } from '../../../components/chat'
import { buildAttachmentPreviewRouteTarget, isRemoteResourceHref } from '../utils/attachments'
import { buildImageGalleryPaths } from '../utils/imageGallery'
import { findChatImageAttachment, saveChatImage } from '../utils/imageSave'
import type { UploadTask } from './useChatUploads'

type ChatMessageWithAttachments = {
  content?: string
  attachments?: ChatAttachmentMeta[]
}

type UseChatPreviewActionsParams = {
  chatWebViewRef: RefObject<ChatWebViewHandle | null>
  hydratedMessages: ChatMessageWithAttachments[]
  machineId: string | null
  router: {
    navigate: (target: { pathname: string; params: Record<string, string> }) => void
  }
  preferSidePreview?: boolean
  onOpenSidePreview?: (params: Record<string, string>) => void
  screenshotBusy: boolean
  send: Parameters<typeof saveChatImage>[0]['send']
  sessionId: string
  setScreenshotBusy: (value: boolean) => void
  setShowSessionDetails: (value: boolean) => void
  showToast: (message: string, type: 'success' | 'error' | 'info') => void
  t: (key: string, options?: any) => string
  title: string
  workDir: string
}

export function useChatPreviewActions(params: UseChatPreviewActionsParams) {
  const {
    chatWebViewRef,
    hydratedMessages,
    machineId,
    router,
    preferSidePreview = false,
    onOpenSidePreview,
    screenshotBusy,
    send,
    sessionId,
    setScreenshotBusy,
    setShowSessionDetails,
    showToast,
    t,
    title,
    workDir,
  } = params

  const handleLongScreenshot = useCallback(async () => {
    if (screenshotBusy) return
    setShowSessionDetails(false)
    setScreenshotBusy(true)

    try {
      const result = await chatWebViewRef.current?.captureLongScreenshot()
      if (!result?.dataUrl) throw new Error('empty')

      const safeTitle =
        title
          .replace(/[\\/:*?"<>|]+/g, '-')
          .trim()
          .slice(0, 48) || 'chat'
      const filename = `${safeTitle}-${new Date().toISOString().replace(/[:.]/g, '-')}.png`

      if (Platform.OS === 'web') {
        const a = document.createElement('a')
        a.href = result.dataUrl
        a.download = filename
        document.body.appendChild(a)
        a.click()
        a.remove()
        return
      }

      const base64 = result.dataUrl.replace(/^data:image\/png;base64,/, '')
      const fileUri = `${FileSystemLegacy.cacheDirectory}${filename}`
      await FileSystemLegacy.writeAsStringAsync(fileUri, base64, {
        encoding: FileSystemLegacy.EncodingType.Base64,
      })
      const shareUrl =
        Platform.OS === 'android' ? await FileSystemLegacy.getContentUriAsync(fileUri) : fileUri
      await Share.share({
        title: filename,
        url: shareUrl,
        message: filename,
      })
    } catch {
      Alert.alert(t('long_screenshot_failed_title'), t('long_screenshot_failed_message'))
    } finally {
      setScreenshotBusy(false)
    }
  }, [chatWebViewRef, screenshotBusy, setScreenshotBusy, setShowSessionDetails, t, title])

  const handleCopyCurrentMessage = useCallback(() => {
    const selectedText =
      typeof window !== 'undefined' ? (window.getSelection?.()?.toString().trim() ?? '') : ''
    const fallbackText =
      [...hydratedMessages]
        .reverse()
        .find((message) => message.content?.trim())
        ?.content?.trim() ?? ''
    const text = selectedText || fallbackText
    if (!text) {
      showToast(t('no_messages'), 'info')
      return
    }
    void Clipboard.setStringAsync(text)
      .then(() => showToast(t('copied'), 'success'))
      .catch(() => showToast(t('error_unknown'), 'error'))
  }, [hydratedMessages, showToast, t])

  const openAttachmentPreview = useCallback(
    (rawPath: string, imagePaths?: string[]) => {
      if (!sessionId) return
      const diaryDate = diaryLinkDate(rawPath)
      if (diaryDate && machineId) {
        router.navigate({ pathname: '/(main)/personal-workspace', params: { kind: 'diary', date: diaryDate, machineId } })
        return
      }
      if (/^shennian:/i.test(rawPath)) return
      if (isRemoteResourceHref(rawPath) && typeof window !== 'undefined') {
        window.open(rawPath, '_blank', 'noopener,noreferrer')
        return
      }
      const target = buildAttachmentPreviewRouteTarget({
        rawPath,
        workDir,
        sessionId,
        hydratedMessages,
      })
      const galleryPaths = buildImageGalleryPaths(imagePaths, workDir)
      if (galleryPaths.length > 1 && galleryPaths.includes(target.params.path)) {
        target.params.imagePaths = JSON.stringify(galleryPaths)
      }
      if (preferSidePreview && onOpenSidePreview && !target.params.imagePaths) {
        onOpenSidePreview(target.params)
        return
      }
      router.navigate(target)
    },
    [hydratedMessages, machineId, onOpenSidePreview, preferSidePreview, router, sessionId, workDir],
  )

  const openUploadPreview = useCallback(
    (task: UploadTask) => {
      if (!sessionId) return
      router.navigate({
        pathname: '/(main)/chat/[sessionId]/preview',
        params: {
          sessionId,
          path: task.path,
          name: task.name,
          mimeType: task.mimeType,
          kind: task.kind,
        },
      })
    },
    [router, sessionId],
  )

  const handleSaveImage = useCallback(
    async (rawPath: string) => {
      const attachment = findChatImageAttachment({
        rawPath,
        workDir,
        messages: hydratedMessages,
      })
      try {
        const result = await saveChatImage({
          attachment,
          send,
          machineId,
          workDir,
        })
        const feedback = downloadFeedback(t, result, attachment.name)
        showToast(feedback.message, feedback.type)
      } catch {
        showToast(t('image_save_failed', { name: attachment.name }), 'error')
      }
    },
    [hydratedMessages, machineId, send, showToast, t, workDir],
  )

  return {
    handleCopyCurrentMessage,
    handleLongScreenshot,
    handleSaveImage,
    openAttachmentPreview,
    openUploadPreview,
  }
}
