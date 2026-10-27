// @arch docs/architecture/app/modular-features.md#聊天-feature

import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react'
import type { TextInput } from 'react-native'
import type { TFunction } from 'i18next'
import {
  appendFileSelectionQuoteDraft,
  buildFileSelectionAiPrompt,
  buildFileSelectionQuoteDraft,
  type FileSelectionAiRequest,
  type FileSelectionQuoteRequest,
} from '../../../components/chat/fileSelectionAi'
import { buildAttachmentMarkdownRef, buildAttachmentMeta } from '../utils/attachments'
import type { useToast } from '../../../hooks/useToast'
import type { useChatSendController } from './useChatSendController'
import type { useVoiceDraft } from './useVoiceDraft'

export function useChatScreenActions({
  editingQueueMessageId,
  handleSend,
  handleSubmitEditQueued,
  input,
  isSending,
  isTyping,
  language,
  machineOffline,
  readOnlySession,
  runPhase,
  setFilePreviewRefreshToken,
  setInput,
  showToast,
  t,
  textInputRef,
  voice,
}: {
  editingQueueMessageId: string | null
  handleSend: ReturnType<typeof useChatSendController>['handleSend']
  handleSubmitEditQueued: ReturnType<typeof useChatSendController>['handleSubmitEditQueued']
  input: string
  isSending: boolean
  isTyping: boolean
  language: string
  machineOffline: boolean
  readOnlySession: boolean
  runPhase: string
  setFilePreviewRefreshToken: Dispatch<SetStateAction<number>>
  setInput: Dispatch<SetStateAction<string>>
  showToast: ReturnType<typeof useToast>['showToast']
  t: TFunction
  textInputRef: RefObject<TextInput | null>
  voice: ReturnType<typeof useVoiceDraft>
}) {
  const pendingAiEditFileRef = useRef<string | null>(null)
  const prevRunActiveRef = useRef(false)

  const handleComposerSend = useCallback(async () => {
    if (readOnlySession) {
      showToast(t('session_readonly_toast'), 'info')
      return
    }
    if (editingQueueMessageId) {
      const updated = await handleSubmitEditQueued()
      if (!updated) showToast(t('msg_edit_queued_failed'), 'error')
      return
    }
    if (voice.phase === 'listening') {
      const result = await voice.stopRecording({ skipRefine: true })
      if (!result) return
      await handleSend({ textOverride: result.draft, bypassVoicePhaseGuard: true })
      return
    }
    if (voice.phase === 'refining') {
      const visibleDraft = input
      await voice.cancelRecording()
      await handleSend({ textOverride: visibleDraft, bypassVoicePhaseGuard: true })
      return
    }
    await handleSend()
  }, [
    editingQueueMessageId,
    handleSend,
    handleSubmitEditQueued,
    input,
    readOnlySession,
    showToast,
    t,
    voice,
  ])

  const handleHoldRelease = useCallback(async () => {
    const result = await voice.stopRecording({ skipRefine: true })
    if (result?.draft.trim()) await handleSend({ textOverride: result.draft, bypassVoicePhaseGuard: true })
  }, [voice, handleSend])

  const handleFileSelectionAiAction = useCallback(
    (request: FileSelectionAiRequest) => {
      if (readOnlySession) {
        showToast(t('session_readonly_toast'), 'info')
        return
      }
      if (machineOffline) {
        showToast(t('machine_offline_error'), 'error')
        return
      }
      pendingAiEditFileRef.current = request.filePath
      void handleSend({ textOverride: buildFileSelectionAiPrompt(request, language) })
      showToast(t('file_ai_sent', { name: request.filename }), 'success')
    },
    [handleSend, language, machineOffline, readOnlySession, showToast, t],
  )

  const handleFileSelectionQuoteAction = useCallback(
    (request: FileSelectionQuoteRequest) => {
      const quoteDraft = buildFileSelectionQuoteDraft(request, language)
      setInput((previous) => appendFileSelectionQuoteDraft(previous, quoteDraft))
      showToast(t('file_selection_quote_inserted', { name: request.filename }), 'success')
      textInputRef.current?.focus()
    },
    [language, setInput, showToast, t, textInputRef],
  )

  useEffect(() => {
    const active = isTyping || isSending || runPhase !== 'idle'
    const wasActive = prevRunActiveRef.current
    prevRunActiveRef.current = active
    if (!wasActive || active || !pendingAiEditFileRef.current) return
    pendingAiEditFileRef.current = null
    setFilePreviewRefreshToken((value) => value + 1)
  }, [isSending, isTyping, runPhase, setFilePreviewRefreshToken])

  const handleInsertRef = useCallback(
    (refPath: string) => {
      const attachment = buildAttachmentMeta({ path: refPath })
      const ref = buildAttachmentMarkdownRef(attachment)
      setInput((previous) => {
        if (!previous.trim()) return `${ref}\n`
        const suffix = previous.endsWith('\n') ? '' : '\n'
        return `${previous}${suffix}${ref}\n`
      })
      showToast(t('file_ref_inserted', { name: attachment.name }), 'success')
      textInputRef.current?.focus()
    },
    [setInput, showToast, t, textInputRef],
  )

  return {
    handleHoldRelease,
    handleComposerSend,
    handleFileSelectionAiAction,
    handleFileSelectionQuoteAction,
    handleInsertRef,
  }
}
