// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/native-fusion-file-watcher.test.ts

import fs from 'node:fs'
import path from 'node:path'

const WATCH_DEBOUNCE_MS = 250

type WatchHandle = { close(): void }
type WatchListener = (eventType: string, filename: string | Buffer | null) => void
type WatchFactory = (target: string, listener: WatchListener) => WatchHandle

export class NativeFusionFileWatcher {
  private directoryWatchers = new Map<string, WatchHandle>()
  private fileWatchers = new Map<string, WatchHandle>()
  private filesByDirectory = new Map<string, Set<string>>()
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(
    private onChanged: (filePaths: string[]) => void,
    private directoryWatchFactory: WatchFactory = (directory, listener) => (
      fs.watch(directory, listener)
    ),
    private fileWatchFactory: WatchFactory = (filePath, listener) => fs.watch(filePath, listener),
  ) {}

  refresh(filePaths: readonly string[], rootDirectories: readonly string[] = []): void {
    const nextFiles = new Set(filePaths)
    const nextFilesByDirectory = new Map<string, Set<string>>()
    for (const filePath of filePaths) {
      const directory = path.dirname(filePath)
      const files = nextFilesByDirectory.get(directory) ?? new Set<string>()
      files.add(filePath)
      nextFilesByDirectory.set(directory, files)
    }

    const nextDirectories = new Set(nextFilesByDirectory.keys())
    for (const root of rootDirectories) {
      this.collectDirectories(root, nextDirectories)
    }

    for (const [directory, watcher] of this.directoryWatchers.entries()) {
      if (nextDirectories.has(directory)) continue
      watcher.close()
      this.directoryWatchers.delete(directory)
    }
    for (const [filePath, watcher] of this.fileWatchers.entries()) {
      if (nextFiles.has(filePath)) continue
      watcher.close()
      this.fileWatchers.delete(filePath)
    }
    this.filesByDirectory = nextFilesByDirectory
    for (const directory of nextDirectories) this.trackDirectory(directory)
    // A directory watcher is sufficient for file creation/rename on all supported
    // platforms, but macOS does not reliably report content appends to an existing
    // child. Watch known transcript files directly so resumed native sessions stay
    // realtime; the periodic full scan remains the fallback when a handle fails.
    for (const filePath of nextFiles) this.trackFile(filePath)
  }

  /** Install the append watcher before parsing a newly discovered transcript. */
  trackFile(filePath: string): void {
    const directory = path.dirname(filePath)
    const files = this.filesByDirectory.get(directory) ?? new Set<string>()
    files.add(filePath)
    this.filesByDirectory.set(directory, files)
    this.trackDirectory(directory)
    if (this.fileWatchers.has(filePath)) return
    try {
      const watcher = this.fileWatchFactory(filePath, () => this.schedule(filePath))
      this.fileWatchers.set(filePath, watcher)
    } catch (error) {
      console.warn(`[native-fusion] unable to watch transcript ${filePath}`, error)
    }
  }

  untrackFile(filePath: string): void {
    this.fileWatchers.get(filePath)?.close()
    this.fileWatchers.delete(filePath)
    const directory = path.dirname(filePath)
    const files = this.filesByDirectory.get(directory)
    files?.delete(filePath)
    if (files?.size === 0) this.filesByDirectory.delete(directory)
  }

  stop(): void {
    for (const watcher of this.directoryWatchers.values()) watcher.close()
    for (const watcher of this.fileWatchers.values()) watcher.close()
    this.directoryWatchers.clear()
    this.fileWatchers.clear()
    this.filesByDirectory.clear()
    for (const timer of this.debounceTimers.values()) clearTimeout(timer)
    this.debounceTimers.clear()
  }

  private handleChange(directory: string, filename: string | Buffer | null): void {
    const changedPath = filename ? path.join(directory, filename.toString()) : null
    if (changedPath) {
      try {
        const stat = fs.statSync(changedPath)
        if (stat.isDirectory()) {
          this.trackDirectoryTree(changedPath, true)
          return
        }
        if (stat.isFile() && isNativeTranscriptPath(changedPath)) {
          this.trackFile(changedPath)
          this.schedule(changedPath)
          return
        }
      } catch {
        if (isNativeTranscriptPath(changedPath)) {
          this.untrackFile(changedPath)
          this.schedule(changedPath)
          return
        }
      }
    }
    const targets = [...(this.filesByDirectory.get(directory) ?? [])]
    for (const target of targets) this.schedule(target)
  }

  private trackDirectory(directory: string): void {
    if (this.directoryWatchers.has(directory)) return
    try {
      const watcher = this.directoryWatchFactory(directory, (_eventType, filename) => {
        this.handleChange(directory, filename)
      })
      this.directoryWatchers.set(directory, watcher)
    } catch (error) {
      console.warn(`[native-fusion] unable to watch ${directory}`, error)
    }
  }

  private collectDirectories(directory: string, output: Set<string>): void {
    if (!fs.existsSync(directory)) return
    let stat: fs.Stats
    try {
      stat = fs.statSync(directory)
    } catch {
      return
    }
    if (!stat.isDirectory()) return
    output.add(directory)
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isDirectory()) this.collectDirectories(path.join(directory, entry.name), output)
    }
  }

  private trackDirectoryTree(directory: string, scheduleDiscoveredFiles: boolean): void {
    this.trackDirectory(directory)
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        this.trackDirectoryTree(fullPath, scheduleDiscoveredFiles)
      } else if (entry.isFile() && isNativeTranscriptPath(fullPath)) {
        this.trackFile(fullPath)
        if (scheduleDiscoveredFiles) this.schedule(fullPath)
      }
    }
  }

  private schedule(filePath: string): void {
    const previous = this.debounceTimers.get(filePath)
    if (previous) clearTimeout(previous)
    const timer = setTimeout(() => {
      this.debounceTimers.delete(filePath)
      this.onChanged([filePath])
    }, WATCH_DEBOUNCE_MS)
    this.debounceTimers.set(filePath, timer)
  }
}

function isNativeTranscriptPath(filePath: string): boolean {
  return filePath.endsWith('.jsonl') || filePath.endsWith('.opencode-session.json')
}
