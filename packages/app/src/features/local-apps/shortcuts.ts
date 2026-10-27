// @arch docs/architecture/local-apps.md
// @test src/__tests__/interactive-content-session.test.ts
import type { LocalApp } from '@shennian/wire'

export type LocalAppShortcut = { machineId: string; appId: string; title: string }
export const appShortcutKey = (entry: LocalAppShortcut) =>
  JSON.stringify([entry.machineId, entry.appId])
export function parseAppShortcuts(raw: string | null): LocalAppShortcut[] {
  try {
    const entries: unknown = JSON.parse(raw || '[]')
    if (!Array.isArray(entries)) return []
    const unique = new Map<string, LocalAppShortcut>()
    for (const entry of entries) {
      if (
        !entry ||
        typeof entry.machineId !== 'string' ||
        !entry.machineId ||
        typeof entry.appId !== 'string' ||
        !entry.appId ||
        typeof entry.title !== 'string' ||
        !entry.title.trim()
      )
        continue
      const shortcut = { machineId: entry.machineId, appId: entry.appId, title: entry.title }
      unique.set(appShortcutKey(shortcut), shortcut)
    }
    return [...unique.values()]
  } catch {
    return []
  }
}
export function createAppShortcutRepository(storage: {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
}) {
  let queue: Promise<unknown> = Promise.resolve()
  const listeners = new Set<(accountId: string) => void>()
  const key = (accountId: string) => 'shennian:localAppShortcuts:' + encodeURIComponent(accountId)
  const read = async (accountId: string) => parseAppShortcuts(await storage.getItem(key(accountId)))
  return {
    subscribe(listener: (accountId: string) => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    read: (accountId: string) => queue.catch(() => {}).then(() => read(accountId)),
    change(
      accountId: string,
      entry: LocalAppShortcut,
      remove = false,
    ): Promise<LocalAppShortcut[]> {
      const write = queue
        .catch(() => {})
        .then(async () => {
          if (!accountId || !parseAppShortcuts(JSON.stringify([entry])).length)
            throw new Error('invalid_shortcut')
          const next = (await read(accountId)).filter(
            (item) => appShortcutKey(item) !== appShortcutKey(entry),
          )
          if (!remove) next.push(entry)
          await storage.setItem(key(accountId), JSON.stringify(next))
          listeners.forEach((listener) => listener(accountId))
          return next
        })
      queue = write
      return write
    },
  }
}

/** Resolve fresh registry metadata and stop before opening if the account/page changed. */
export async function resolveAppShortcut(
  machineId: string,
  appId: string,
  client: {
    apps(machineId: string): Promise<{ apps: LocalApp[] }>
    runtime(machineId: string, appId: string): Promise<{ runtimePath: string }>
  },
  active: () => boolean,
) {
  const app = (await client.apps(machineId)).apps.find((app) => app.id === appId)
  if (!active()) return null
  if (!app) throw new Error(JSON.stringify({ error: 'local_app_unavailable' }))
  const runtime = await client.runtime(machineId, appId)
  return active() ? { app, runtimePath: runtime.runtimePath } : null
}
