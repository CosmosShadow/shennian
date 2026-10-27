// @arch docs/architecture/app/modular-features.md#登录-feature
// @test packages/app/src/__tests__/qr-login-availability.test.ts

const DESKTOP_WEB_MIN_WIDTH = 768

export function canShowQrLogin(
  platform: string,
  viewportWidth: number,
  isDesktopShell: boolean,
): boolean {
  return platform === 'web' && (isDesktopShell || viewportWidth >= DESKTOP_WEB_MIN_WIDTH)
}
