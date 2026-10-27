// @arch docs/design/desktop/macos-interaction-baseline.md
// @test ../../__tests__/desktop-settings-leave-guard.test.ts

/** One active desktop editor owns leaving; stale cleanup cannot remove a newer owner. */
export function createDesktopNavigationGuard() {
  let current: { request: (next: () => void) => void } | null = null
  return {
    register(request: (next: () => void) => void) {
      const owner = { request }
      current = owner
      return () => { if (current === owner) current = null }
    },
    request(next: () => void) {
      if (current) current.request(next)
      else next()
    },
  }
}

export const desktopNavigationGuard = createDesktopNavigationGuard()
