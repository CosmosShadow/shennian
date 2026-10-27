// @arch docs/architecture/app/modular-features.md#聊天-feature
// @test src/__tests__/chat-screen-utils.test.ts
import { useEffect, useRef } from 'react'
import { useRouter } from 'expo-router'
import type { ChatMessage } from '@shennian/shared'
import type { NianSession } from '@shennian/wire'
import { buildAgentInstallPrompt, type InstallableBuiltinAgentType } from '../../machines/utils/launch'

export function useChatAutoInstall({ sessionId, session, autoInstallAgent, readOnlySession,
  relayState, isTyping, isSending, isUploading, voicePhase, messages, handleSend }: {
  sessionId: string; session?: NianSession; autoInstallAgent: InstallableBuiltinAgentType | null; readOnlySession: boolean;
  relayState: string; isTyping: boolean; isSending: boolean; isUploading: boolean; voicePhase: string;
  messages: ChatMessage[]; handleSend: (options: { textOverride: string; bypassVoicePhaseGuard: boolean }) => Promise<unknown>;
}) {
  const router = useRouter()
  const autoInstallHandledRef = useRef<string | null>(null)
  useEffect(() => {
    if (!sessionId || !session || !autoInstallAgent || readOnlySession) return

    const installKey = `${sessionId}:${autoInstallAgent}`
    if (autoInstallHandledRef.current === installKey) return
    if (
      relayState !== 'connected' ||
      isTyping ||
      isSending ||
      isUploading ||
      voicePhase !== 'idle'
    )
      return

    autoInstallHandledRef.current = installKey

    if (messages.some((message) => message.role === 'user')) {
      router.replace(`/(main)/chat/${sessionId}`)
      return
    }

    void handleSend({
      textOverride: buildAgentInstallPrompt(autoInstallAgent),
      bypassVoicePhaseGuard: true,
    })
    router.replace(`/(main)/chat/${sessionId}`)
  }, [
    autoInstallAgent,
    handleSend,
    isSending,
    isTyping,
    isUploading,
    messages,
    relayState,
    readOnlySession,
    router,
    session,
    sessionId,
    voicePhase,
  ])


}
