export type SidebarSectionActionVisibility = 'hidden' | 'subdued' | 'persistent'

export function getSidebarSectionActionOpacity(
  visibility: SidebarSectionActionVisibility,
  revealed: boolean,
): number {
  if (revealed || visibility === 'persistent') return 1
  return visibility === 'subdued' ? 0.38 : 0
}
