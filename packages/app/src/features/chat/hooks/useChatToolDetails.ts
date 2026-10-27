// @arch docs/architecture/app/modular-features.md#聊天-feature
// @test src/__tests__/desktop-chat-controller.test.ts

import { useCallback, useEffect, useMemo, useState } from 'react'
import { type ChatMessage, type ToolCall, useSessionsStore } from '@shennian/shared'
import type { SessionToolDetailResponse } from '@shennian/wire'
import { buildToolDetailRequest } from '../utils/toolDetail'
import type { useAccountMachine } from '../../account-runtime/useAccountMachine'

type ToolDetailOverlay = Partial<
  Pick<
    ToolCall,
    | 'name'
    | 'status'
    | 'command'
    | 'argsSummary'
    | 'result'
    | 'resultOmitted'
    | 'detailStatus'
    | 'detailMessage'
  >
>

type SendMachineRequest = ReturnType<typeof useAccountMachine>['send']

function toolDetailKey(messageId: string, toolIndex: number, tool?: ToolCall): string {
  return tool?.toolCallId && Number.isSafeInteger(tool.detailRevision)
    ? `${tool.toolCallId}:${tool.detailRevision}`
    : `${messageId}:${toolIndex}`
}

function mergeToolDetailOverlays(
  messages: ChatMessage[],
  overlays: Record<string, ToolDetailOverlay>,
): ChatMessage[] {
  if (Object.keys(overlays).length === 0) return messages
  return messages.map((message) => {
    if (!message.toolCalls?.length) return message
    let changed = false
    const toolCalls = message.toolCalls.map((toolCall, index) => {
      const overlay = overlays[toolDetailKey(message.id, index, toolCall)]
      if (!overlay) return toolCall
      changed = true
      return { ...toolCall, ...overlay }
    })
    return changed ? { ...message, toolCalls } : message
  })
}

function resolveToolDetailStatus(error?: string): ToolCall['detailStatus'] {
  const message = String(error || '')
  if (/offline|离线|not connected|disconnect|network|timeout/i.test(message)) return 'offline'
  return /unknown method|not implemented|unsupported/i.test(message) ? 'unsupported' : 'error'
}

export function useChatToolDetails({
  daemonInstallationId,
  machineId,
  machineOffline,
  messages,
  relayState,
  send,
  sessionId,
}: {
  daemonInstallationId?: string
  machineId: string | null
  machineOffline: boolean
  messages: ChatMessage[]
  relayState: string
  send: SendMachineRequest
  sessionId: string
}) {
  const [overlays, setOverlays] = useState<Record<string, ToolDetailOverlay>>({})
  const hydratedMessagesWithToolDetails = useMemo(
    () => mergeToolDetailOverlays(messages, overlays),
    [messages, overlays],
  )

  useEffect(() => {
    setOverlays({})
  }, [sessionId])

  const setToolDetailState = useCallback(
    (
      messageId: string,
      toolIndex: number,
      tool: ToolCall | undefined,
      overlay: ToolDetailOverlay,
    ) => {
      const key = toolDetailKey(messageId, toolIndex, tool)
      setOverlays((previous) => ({
        ...previous,
        [key]: { ...previous[key], ...overlay },
      }))
    },
    [],
  )

  const handleToolDetailRequest = useCallback(
    async (request: {
      messageId: string
      toolIndex: number
      name?: string
      detailRef?: unknown
    }) => {
      const toolIndex = Number.isInteger(request.toolIndex) ? request.toolIndex : 0
      const message = hydratedMessagesWithToolDetails.find((item) => item.id === request.messageId)
      const currentTool = message?.toolCalls?.[toolIndex]
      const updateCurrentTool = (overlay: ToolDetailOverlay) =>
        setToolDetailState(request.messageId, toolIndex, currentTool, overlay)
      const hasInputDetail =
        currentTool?.args != null || currentTool?.argsSummary != null || !!currentTool?.command
      if (
        currentTool?.detailStatus === 'loading' ||
        currentTool?.detailStatus === 'loaded' ||
        (hasInputDetail && currentTool?.result != null)
      ) {
        return
      }

      const detailRequest = buildToolDetailRequest(sessionId, daemonInstallationId, currentTool)
      if (!detailRequest) {
        updateCurrentTool({
          name: request.name ?? currentTool?.name,
          status: currentTool?.status,
          resultOmitted: currentTool?.result == null,
          detailStatus: 'unsupported',
          detailMessage: 'upgrade_required',
        })
        return
      }

      if (!machineId || machineOffline || relayState !== 'connected') {
        updateCurrentTool({
          name: request.name ?? currentTool?.name,
          status: currentTool?.status,
          resultOmitted: currentTool?.result == null,
          detailStatus: 'offline',
        })
        return
      }

      updateCurrentTool({
        name: request.name ?? currentTool?.name,
        status: currentTool?.status,
        resultOmitted: currentTool?.result == null,
        detailStatus: 'loading',
      })

      try {
        const response = await send({
          type: 'req',
          method: 'session.tool.detail',
          params: detailRequest,
        })
        if (!useSessionsStore.getState().sessions.some((item) => item.id === sessionId)) return

        if (!response.ok) {
          updateCurrentTool({
            name: request.name ?? currentTool?.name,
            status: currentTool?.status,
            resultOmitted: currentTool?.result == null,
            detailStatus: resolveToolDetailStatus(response.error),
            detailMessage: response.error,
          })
          return
        }

        const payload = response.payload as SessionToolDetailResponse | undefined
        if (payload?.detailStatus === 'available') {
          updateCurrentTool({
            name: request.name ?? currentTool?.name,
            status: payload.status ?? currentTool?.status,
            command: payload.command,
            argsSummary: payload.argsSummary,
            result: payload.result,
            resultOmitted: payload.resultOmitted,
            detailStatus: 'loaded',
          })
          return
        }

        updateCurrentTool({
          name: request.name ?? currentTool?.name,
          status: payload?.status ?? currentTool?.status,
          resultOmitted: payload?.resultOmitted ?? currentTool?.result == null,
          detailStatus: payload?.detailStatus === 'unsupported' ? 'unsupported' : 'unavailable',
          detailMessage: payload?.reason,
        })
      } catch (error) {
        if (!useSessionsStore.getState().sessions.some((item) => item.id === sessionId)) return
        const messageText = error instanceof Error ? error.message : String(error)
        updateCurrentTool({
          name: request.name ?? currentTool?.name,
          status: currentTool?.status,
          resultOmitted: currentTool?.result == null,
          detailStatus: /not connected|disconnect|network|timeout/i.test(messageText)
            ? 'offline'
            : 'error',
          detailMessage: messageText,
        })
      }
    },
    [
      daemonInstallationId,
      hydratedMessagesWithToolDetails,
      machineId,
      machineOffline,
      relayState,
      send,
      sessionId,
      setToolDetailState,
    ],
  )

  return { handleToolDetailRequest, hydratedMessagesWithToolDetails }
}
