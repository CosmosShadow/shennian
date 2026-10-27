// @arch docs/features/desktop-appearance-language-preferences.md#原生状态栏
// @test src/__tests__/status-bar-restoration.test.ts

/** The active native screen owns the status bar, including transition restoration. */
export function getNativeStatusBarOptions(isDark: boolean) {
  return {
    statusBarStyle: isDark ? 'light' as const : 'dark' as const,
    statusBarHidden: false,
    statusBarAnimation: 'none' as const,
  }
}
