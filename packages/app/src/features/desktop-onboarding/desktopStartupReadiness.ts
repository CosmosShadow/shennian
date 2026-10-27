// @arch docs/features/desktop-login-and-first-use.md
// @test ../../__tests__/desktop-login-and-first-use.test.ts

/**
 * Desktop must restore its main-process session before mounting any route.
 * Ordinary public Web keeps its hydration-safe first render, while native also
 * waits for device storage as before.
 */
export function isInitialAppReady(input: {
  server: boolean
  web: boolean
  desktop: boolean
  singleRoomWeb: boolean
}): boolean {
  if (input.server || input.singleRoomWeb) return true
  if (input.web) return !input.desktop
  return false
}
