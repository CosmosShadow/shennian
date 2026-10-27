// @arch open-source/docs/cli-runtime.md
// @covers src/native-fusion/file-watcher.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NativeFusionFileWatcher } from '../native-fusion/file-watcher.js'

describe('NativeFusionFileWatcher', () => {
  afterEach(() => vi.useRealTimers())

  it('debounces a changed transcript into a targeted file scan', () => {
    vi.useFakeTimers()
    const listeners = new Map<string, (event: string, filename: string | null) => void>()
    const closed: string[] = []
    const onChanged = vi.fn()
    const watchFactory = (target: string, listener: (event: string, filename: string | null) => void) => {
      listeners.set(target, listener)
      return { close: () => closed.push(target) }
    }
    const watcher = new NativeFusionFileWatcher(onChanged, watchFactory, watchFactory)
    const directory = path.join('/tmp', 'native-watch')
    const first = path.join(directory, 'rollout-1.jsonl')
    watcher.refresh([first])

    listeners.get(directory)?.('change', 'rollout-2.jsonl')
    listeners.get(directory)?.('change', 'rollout-2.jsonl')
    vi.advanceTimersByTime(249)
    expect(onChanged).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onChanged).toHaveBeenCalledOnce()
    expect(onChanged).toHaveBeenCalledWith([path.join(directory, 'rollout-2.jsonl')])

    watcher.stop()
    expect(closed.sort()).toEqual([directory, first].sort())
  })

  it('watches a known transcript directly when directory content events are absent', () => {
    vi.useFakeTimers()
    const fileListeners = new Map<string, (event: string, filename: string | null) => void>()
    const onChanged = vi.fn()
    const directoryWatchFactory = vi.fn(() => ({ close: vi.fn() }))
    const fileWatchFactory = vi.fn((
      filePath: string,
      listener: (event: string, filename: string | null) => void,
    ) => {
      fileListeners.set(filePath, listener)
      return { close: vi.fn() }
    })
    const filePath = '/tmp/native-watch/resumed.jsonl'
    const watcher = new NativeFusionFileWatcher(
      onChanged,
      directoryWatchFactory,
      fileWatchFactory,
    )
    watcher.refresh([filePath])

    fileListeners.get(filePath)?.('change', null)
    vi.advanceTimersByTime(250)

    expect(onChanged).toHaveBeenCalledWith([filePath])
    watcher.stop()
  })

  it('installs a direct watcher before scanning a newly created transcript', () => {
    vi.useFakeTimers()
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'native-watch-new-file-'))
    const directoryListeners = new Map<string, (event: string, filename: string | null) => void>()
    const fileWatchFactory = vi.fn(() => ({ close: vi.fn() }))
    const onChanged = vi.fn()
    const watcher = new NativeFusionFileWatcher(
      onChanged,
      (target, listener) => {
        directoryListeners.set(target, listener)
        return { close: vi.fn() }
      },
      fileWatchFactory,
    )
    watcher.refresh([], [directory])
    const created = path.join(directory, 'rollout-new.jsonl')
    fs.writeFileSync(created, '{"type":"session_meta"}\n')

    directoryListeners.get(directory)?.('rename', path.basename(created))

    expect(fileWatchFactory).toHaveBeenCalledWith(created, expect.any(Function))
    expect(onChanged).not.toHaveBeenCalled()
    vi.advanceTimersByTime(250)
    expect(onChanged).toHaveBeenCalledWith([created])
    watcher.stop()
  })

  it('discovers a new subtree below an empty watched root', () => {
    vi.useFakeTimers()
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-watch-root-'))
    const directoryListeners = new Map<string, (event: string, filename: string | null) => void>()
    const watchedFiles: string[] = []
    const onChanged = vi.fn()
    const watcher = new NativeFusionFileWatcher(
      onChanged,
      (target, listener) => {
        directoryListeners.set(target, listener)
        return { close: vi.fn() }
      },
      (target) => {
        watchedFiles.push(target)
        return { close: vi.fn() }
      },
    )
    watcher.refresh([], [root])
    const nested = path.join(root, '2026', '09', '03')
    fs.mkdirSync(nested, { recursive: true })
    const created = path.join(nested, 'rollout.jsonl')
    fs.writeFileSync(created, '{"type":"session_meta"}\n')

    directoryListeners.get(root)?.('rename', '2026')
    vi.advanceTimersByTime(250)

    expect(directoryListeners.has(path.join(root, '2026'))).toBe(true)
    expect(directoryListeners.has(nested)).toBe(true)
    expect(watchedFiles).toContain(created)
    expect(onChanged).toHaveBeenCalledWith([created])
    watcher.stop()
  })

  it('falls back to known files when a platform omits the changed filename', () => {
    vi.useFakeTimers()
    let listener: ((event: string, filename: string | null) => void) | undefined
    const onChanged = vi.fn()
    const watcher = new NativeFusionFileWatcher(
      onChanged,
      (_directory, nextListener) => {
        listener = nextListener
        return { close: vi.fn() }
      },
      () => ({ close: vi.fn() }),
    )
    const first = '/tmp/native-watch/one.jsonl'
    const second = '/tmp/native-watch/two.jsonl'
    watcher.refresh([first, second])
    listener?.('rename', null)
    vi.advanceTimersByTime(250)

    expect(onChanged.mock.calls.map(([files]) => files[0]).sort()).toEqual([first, second])
    watcher.stop()
  })
})
