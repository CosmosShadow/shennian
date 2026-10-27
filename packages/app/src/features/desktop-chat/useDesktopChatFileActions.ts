// @arch docs/architecture/app/modular-features.md#附件与本地资源预览
// @test src/__tests__/chat-attachments.test.ts

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react'
import type { TFunction } from 'i18next'
import type { TextInput } from 'react-native'
import type { useRouter } from 'expo-router'
import type { ChatMessage } from '@shennian/shared'
import type { ChatWebViewHandle } from '../../components/chat'
import {
  appendFileSelectionQuoteDraft,
  buildFileSelectionAiPrompt,
  buildFileSelectionQuoteDraft,
  type FileSelectionAiRequest,
  type FileSelectionQuoteRequest,
} from '../../components/chat/fileSelectionAi'
import type { useToast } from '../../hooks/useToast'
import { buildAttachmentMarkdownRef, buildAttachmentMeta } from '../chat/utils/attachments'
import { useChatPreviewActions } from '../chat/hooks/useChatPreviewActions'
import type { useChatSendController } from '../chat/hooks/useChatSendController'
import type { useAccountMachine } from '../account-runtime/useAccountMachine'

type Router = ReturnType<typeof useRouter>
type Send = ReturnType<typeof useAccountMachine>['send']
type HandleSend = ReturnType<typeof useChatSendController>['handleSend']
type ShowToast = ReturnType<typeof useToast>['showToast']

export function useDesktopChatFileActions({
  chatWebViewRef,
  handleSend,
  hydratedMessages,
  i18nLanguage,
  isSending,
  isTyping,
  machineId,
  machineOffline,
  openFileDrawer,
  readOnlySession,
  router,
  runPhase,
  send,
  sessionId,
  setInput,
  setShowSessionDetails,
  showToast,
  t,
  textInputRef,
  title,
  workDir,
}: {
  chatWebViewRef: RefObject<ChatWebViewHandle | null>
  handleSend: HandleSend
  hydratedMessages: ChatMessage[]
  i18nLanguage: string
  isSending: boolean
  isTyping: boolean
  machineId: string | null
  machineOffline: boolean
  openFileDrawer: () => void
  readOnlySession: boolean
  router: Router
  runPhase: string
  send: Send
  sessionId: string
  setInput: Dispatch<SetStateAction<string>>
  setShowSessionDetails: (visible: boolean) => void
  showToast: ShowToast
  t: TFunction
  textInputRef: RefObject<TextInput | null>
  title: string
  workDir: string
}) {
  const [filePreviewRefreshRevision, setFilePreviewRefreshRevision] = useState(0)
  const [sidePreviewRequest, setSidePreviewRequest] = useState<{
    id: number
    path: string
    name: string
    kind?: 'folder'
    line?: number
    endLine?: number
  } | null>(null)
  const [screenshotBusy, setScreenshotBusy] = useState(false)
  const pendingAiEditFileRef = useRef<string | null>(null)
  const previousRunActiveRef = useRef(false)

  const openFileDrawerFromDetails = useCallback(() => {
    if (machineOffline) {
      showToast(t('machine_offline_error'), 'error')
      return
    }
    setShowSessionDetails(false)
    openFileDrawer()
  }, [machineOffline, openFileDrawer, setShowSessionDetails, showToast, t])

  const openSideFilePreview = useCallback(
    (params: Record<string, string>) => {
      if (!params.path) return
      setShowSessionDetails(false)
      openFileDrawer()
      const line = Number(params.line)
      const endLine = Number(params.endLine)
      setSidePreviewRequest({
        id: Date.now(),
        path: params.path,
        name: params.name || params.path.split(/[\\/]/).pop() || params.path,
        ...(params.kind === 'folder' ? { kind: 'folder' as const } : {}),
        ...(Number.isInteger(line) && line > 0 ? { line } : {}),
        ...(Number.isInteger(endLine) && endLine > 0 ? { endLine } : {}),
      })
    },
    [openFileDrawer, setShowSessionDetails],
  )

  const previewActions = useChatPreviewActions({
    chatWebViewRef,
    hydratedMessages,
    machineId,
    preferSidePreview: true,
    onOpenSidePreview: openSideFilePreview,
    router,
    screenshotBusy,
    send,
    sessionId,
    setScreenshotBusy,
    setShowSessionDetails,
    showToast,
    t,
    title,
    workDir,
  })

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
      const prompt = buildFileSelectionAiPrompt(request, i18nLanguage)
      pendingAiEditFileRef.current = request.filePath
      void handleSend({ textOverride: prompt })
      showToast(t('file_ai_sent', { name: request.filename }), 'success')
    },
    [handleSend, i18nLanguage, machineOffline, readOnlySession, showToast, t],
  )

  const handleFileSelectionQuoteAction = useCallback(
    (request: FileSelectionQuoteRequest) => {
      const quoteDraft = buildFileSelectionQuoteDraft(request, i18nLanguage)
      setInput((previous) => appendFileSelectionQuoteDraft(previous, quoteDraft))
      showToast(t('file_selection_quote_inserted', { name: request.filename }), 'success')
      textInputRef.current?.focus()
    },
    [i18nLanguage, setInput, showToast, t, textInputRef],
  )

  useEffect(() => {
    const active = isTyping || isSending || runPhase !== 'idle'
    const wasActive = previousRunActiveRef.current
    previousRunActiveRef.current = active
    if (!wasActive || active || !pendingAiEditFileRef.current) return
    pendingAiEditFileRef.current = null
    setFilePreviewRefreshRevision((value) => value + 1)
  }, [isSending, isTyping, runPhase])

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
    filePreviewRefreshRevision,
    handleFileSelectionAiAction,
    handleFileSelectionQuoteAction,
    handleInsertRef,
    openFileDrawerFromDetails,
    sidePreviewRequest,
    ...previewActions,
  }
}
