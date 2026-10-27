// @arch docs/design/desktop/unified-desktop-control.md#键盘与无障碍
// @test ../../__tests__/desktop-settings-category-interaction.test.ts

export function handleDesktopSettingsEscape({
  categoryPickerOpen,
  closeCategoryPicker,
  focusCategoryPicker,
  leaveSettings,
}: {
  categoryPickerOpen: boolean
  closeCategoryPicker: () => void
  focusCategoryPicker: () => void
  leaveSettings: () => void
}): void {
  if (categoryPickerOpen) {
    closeCategoryPicker()
    focusCategoryPicker()
    return
  }
  leaveSettings()
}

export function selectDesktopSettingsCategory(select: () => void, close: () => void, focusPicker: () => void): void {
  select()
  close()
  focusPicker()
}
