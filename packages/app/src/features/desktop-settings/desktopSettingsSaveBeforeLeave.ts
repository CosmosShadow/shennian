// @arch docs/design/desktop/unified-desktop-control.md#设置页面
// @test ../../__tests__/desktop-settings-save-before-leave.test.ts
export async function saveDesktopSettingsBeforeLeave(
  save: () => Promise<boolean>,
  isCurrent: () => boolean,
  leave: () => void,
): Promise<void> {
  if (!isCurrent()) return
  if (await save() && isCurrent()) leave()
}
