// @arch docs/features/desktop-local-first-client.md
// @test ../../__tests__/desktop-sync-lifecycle.test.ts

type OnlineEventSource = {
  navigator: { onLine: boolean }
  addEventListener(type: 'online' | 'offline', listener: () => void): void
  removeEventListener(type: 'online' | 'offline', listener: () => void): void
}

export function subscribeDesktopNetworkStatus(
  update: (online: boolean) => void,
  source: OnlineEventSource | null = typeof window === 'undefined' ? null : window,
): () => void {
  if (!source) return () => {}
  const online = () => update(true)
  const offline = () => update(false)
  update(source.navigator.onLine)
  source.addEventListener('online', online)
  source.addEventListener('offline', offline)
  return () => {
    source.removeEventListener('online', online)
    source.removeEventListener('offline', offline)
  }
}

type LifecycleEvent = {
  revision: number
  value: { state: 'suspended' | 'resumed' }
}
type LifecycleSubscriber = (callback: (event: LifecycleEvent) => void) => () => void

function getDesktopLifecycleSubscriber(): LifecycleSubscriber | undefined {
  return (
    globalThis as typeof globalThis & {
      shennianDesktop?: { lifecycle?: { subscribe: LifecycleSubscriber } }
    }
  ).shennianDesktop?.lifecycle?.subscribe
}

export function subscribeDesktopPowerLifecycle(
  update: (active: boolean) => void,
  subscribe: LifecycleSubscriber | undefined = getDesktopLifecycleSubscriber(),
): () => void {
  if (!subscribe) return () => {}
  return subscribe((event) => update(event.value.state === 'resumed'))
}
