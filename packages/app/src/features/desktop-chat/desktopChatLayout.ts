// @arch docs/design/desktop/unified-desktop-control.md
// @test packages/app/src/__tests__/desktop-main-workspaces.test.ts

export const DESKTOP_CHAT_NARROW_BREAKPOINT = 900

export function resolveDesktopChatLayout(input: {
  width: number
  contextOpen: boolean
}): {
  mode: 'wide' | 'narrow'
  showConversation: boolean
  showContext: boolean
} {
  if (input.width >= DESKTOP_CHAT_NARROW_BREAKPOINT) {
    return {
      mode: 'wide',
      showConversation: true,
      showContext: input.contextOpen,
    }
  }
  return {
    mode: 'narrow',
    showConversation: !input.contextOpen,
    showContext: input.contextOpen,
  }
}
