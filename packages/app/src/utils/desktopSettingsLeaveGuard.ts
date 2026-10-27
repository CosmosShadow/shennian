// @arch docs/design/desktop/unified-desktop-control.md#设置页面
// @test ../__tests__/desktop-settings-leave-guard.test.ts

export function hasUnsavedDesktopTextSetting(
  editing: boolean,
  draft: string,
  saved: string,
): boolean {
  return editing && draft !== saved
}

export function shouldConfirmDesktopSettingsLeave(dirtySettings: readonly boolean[]): boolean {
  return dirtySettings.some(Boolean)
}
