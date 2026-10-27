// @arch docs/architecture/app/modular-features.md#登录-feature
// @test packages/app/src/__tests__/qr-login.test.ts

export function qrLoginDeepLink(qrId: string): string {
  return `qr:${qrId}`
}

/** Never surface server messages, response bodies, URLs or credentials as diagnostics. */
export function qrLoginFailureCode(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null
  return typeof code === 'string' && [
    'CREDENTIAL_COMMIT_FAILED', 'UNAVAILABLE', 'WRITE_FAILED', 'INVALID_AUTH_RESPONSE',
    'QR_STATUS_REJECTED', 'AUTH_OPERATION_SUPERSEDED', 'NO_ACTIVE_ACCOUNT',
  ].includes(code) ? code : 'QR_LOGIN_FAILED'
}

export async function createQrLoginDataUrl(qrId: string): Promise<string> {
  const QRCode = require('qrcode') as {
    toDataURL: (text: string, options: Record<string, unknown>) => Promise<string>
  }

  return QRCode.toDataURL(qrLoginDeepLink(qrId), {
    width: 300,
    margin: 1,
    errorCorrectionLevel: 'M',
  })
}
