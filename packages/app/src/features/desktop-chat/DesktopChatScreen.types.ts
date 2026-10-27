// @arch docs/architecture/app/modular-features.md#聊天-feature
// @test src/__tests__/desktop-chat-controller.test.ts

import type { ChatScrollPosition } from '../chat/utils/scrollPositionStorage'
import type { PublicAvatar } from '../rooms/types'

export interface DesktopChatScreenProps {
  sessionIdOverride?: string
  workspaceRoomId?: string
  workspaceAgentIdentityId?: string
  workspaceAgentName?: string
  workspaceAgentAvatar?: PublicAvatar | null
  workspaceAgentOwnerAvatar?: PublicAvatar | null
  workspaceAgentOwnerName?: string | null
  workspaceInitialScrollPosition?: ChatScrollPosition | null
  onWorkspaceScrollPositionChange?: (position: ChatScrollPosition) => void
  onOpenWorkerSession?: (sessionId: string, title: string) => void
  embedded?: boolean
  hideHeader?: boolean
}
