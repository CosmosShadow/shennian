// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/acp-manifests.test.ts

import fs, { type FSWatcher } from 'node:fs'
import { getAcpManifestDirectory } from './manifests.js'

const DEFAULT_SCAN_INTERVAL_MS = 12 * 60 * 60 * 1_000
const DEFAULT_CATALOG_INTERVAL_MS = 6 * 60 * 60 * 1_000
const DEFAULT_DEBOUNCE_MS = 500

export class AcpDiscoveryWatcher {
  private watcher: FSWatcher | null = null
  private debounceTimer: NodeJS.Timeout | null = null
  private intervalTimer: NodeJS.Timeout | null = null
  private catalogTimer: NodeJS.Timeout | null = null
  private running: Promise<void> | null = null
  private rerun = false

  constructor(
    private readonly refresh: () => Promise<void>,
    private readonly options: {
      directory?: string
      intervalMs?: number
      catalogIntervalMs?: number
      debounceMs?: number
    } = {},
  ) {}

  start(): void {
    if (this.watcher || this.intervalTimer) return
    const directory = this.options.directory ?? getAcpManifestDirectory()
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
    if (process.platform !== 'win32') fs.chmodSync(directory, 0o700)
    this.watcher = fs.watch(directory, { persistent: false }, () => this.notifyManifestChanged())
    this.watcher.on('error', () => {
      this.watcher?.close()
      this.watcher = null
    })
    this.intervalTimer = setInterval(
      () => this.trigger(),
      this.options.intervalMs ?? DEFAULT_SCAN_INTERVAL_MS,
    )
    this.intervalTimer.unref?.()
    this.catalogTimer = setInterval(
      () => this.trigger(),
      this.options.catalogIntervalMs ?? DEFAULT_CATALOG_INTERVAL_MS,
    )
    this.catalogTimer.unref?.()
  }

  stop(): void {
    this.watcher?.close()
    this.watcher = null
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    if (this.intervalTimer) clearInterval(this.intervalTimer)
    if (this.catalogTimer) clearInterval(this.catalogTimer)
    this.debounceTimer = null
    this.intervalTimer = null
    this.catalogTimer = null
  }

  /** Public so platform watcher adapters and deterministic tests share one debounce path. */
  notifyManifestChanged(): void {
    this.schedule()
  }

  private schedule(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      this.trigger()
    }, this.options.debounceMs ?? DEFAULT_DEBOUNCE_MS)
    this.debounceTimer.unref?.()
  }

  private trigger(): void {
    if (this.running) {
      this.rerun = true
      return
    }
    this.running = this.refresh()
      .catch(() => {})
      .finally(() => {
        this.running = null
        if (this.rerun) {
          this.rerun = false
          this.trigger()
        }
      })
  }
}
