// @arch docs/features/desktop-action-discoverability.md
// @test src/__tests__/chat-image-action-discoverability.test.ts

export type PreventableContextMenuEvent = {
  preventDefault(): void
}

export type AttachmentImageCommands = {
  open(path: string): void
  openActions?(path: string): void
}

/**
 * Keep pointer, context-menu, and visible-button entry points bound to the
 * same image commands. This is deliberately DOM-independent so the contract
 * remains behavior-testable without relying on browser event synthesis.
 */
export function createAttachmentImageActionHandlers(
  path: string,
  commands: AttachmentImageCommands,
) {
  const open = () => commands.open(path)
  const openActions = () => commands.openActions?.(path)
  const contextMenu = (event: PreventableContextMenuEvent) => {
    event.preventDefault()
    openActions()
  }

  return { open, openActions, contextMenu }
}
