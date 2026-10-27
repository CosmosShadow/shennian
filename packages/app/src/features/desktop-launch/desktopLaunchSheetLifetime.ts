// @arch docs/features/desktop-local-first-client.md
// @test ../../__tests__/desktop-project-launch-sheet.test.ts
/** Account changes invalidate capabilities immediately, including A → B → A between renders. */
export function createDesktopLaunchSheetLifetime(options: {
  account(): string | null
  context(): unknown
  subscribeAccount(listener: () => void): () => void
  close(): void
}) {
  let account = options.account()
  let generation = 0
  let active = false
  return {
    start() {
      active = true
      const lifetime = ++generation
      const check = () => {
        const next = options.account()
        if (next === account) return
        account = next
        options.close()
      }
      const unsubscribe = options.subscribeAccount(check)
      check()
      return () => {
        active = false
        unsubscribe()
        const context = options.context()
        // StrictMode reattaches synchronously. Only a real detached lifetime clears its own sheet.
        queueMicrotask(() => {
          if (!active && generation === lifetime && context && options.context() === context) options.close()
        })
      }
    },
  }
}
