// @arch docs/design/desktop/macos-interaction-baseline.md
// @test packages/app/src/__tests__/desktop-personal-chat-presentation.test.ts

export type DesktopContextControlMode = 'hidden' | 'status' | 'menu'

export function resolveDesktopModelControl(input: {
  modelCount: number
  configuredModelId?: string | null
  canFollowAgentModel: boolean
  manager: boolean
}) {
  const visible = input.modelCount > 0 || Boolean(input.configuredModelId?.trim())
  const choiceCount = input.modelCount + (input.canFollowAgentModel ? 1 : 0)
  return {
    visible,
    canSwitch: visible && !input.manager && choiceCount > 1,
  }
}

export function toggleDesktopContextMenu(open: boolean, mode: DesktopContextControlMode, busy = false): boolean {
  return !open && mode === 'menu' && !busy
}

export function nextDesktopContextMenuIndex(
  key: string, current: number, count: number, editingSearch = false,
): number | null {
  if (count === 0) return null
  if (editingSearch && key !== 'ArrowDown' && key !== 'ArrowUp') return null
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  if (key === 'ArrowDown') return current < 0 ? 0 : (current + 1) % count
  if (key === 'ArrowUp') return current < 0 ? count - 1 : (current - 1 + count) % count
  return null
}

export function filterDesktopModels<T extends { id: string; name: string; description?: string }>(
  models: readonly T[], query: string,
): T[] {
  const normalized = query.trim().toLocaleLowerCase()
  return models.filter((model) => !normalized ||
    `${model.id} ${model.name} ${model.description ?? ''}`.toLocaleLowerCase().includes(normalized))
}

export function resolveDesktopContextControlMode(input: {
  visible: boolean
  optionCount: number
}): DesktopContextControlMode {
  if (!input.visible) return 'hidden'
  return input.optionCount > 1 ? 'menu' : 'status'
}
