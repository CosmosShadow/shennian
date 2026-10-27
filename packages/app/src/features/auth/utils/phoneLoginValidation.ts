// @arch docs/features/desktop-login-and-first-use.md
// @test ../../../__tests__/desktop-login-and-first-use.test.ts

export function isPhoneLoginNumberComplete(phone: string): boolean {
  return /^\d{11}$/.test(phone)
}

export function isPhoneLoginCodeComplete(code: string): boolean {
  return /^\d{4,6}$/.test(code)
}
