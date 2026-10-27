// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/process-tree.test.ts, src/__tests__/acp-adapter.test.ts

import { spawn, type ChildProcess } from 'node:child_process'

/**
 * POSIX children must be spawned with `detached: true` so the leader owns a
 * process group; without it `-pid` signals reach nothing and only the leader
 * is stopped. Windows relies on `taskkill /T` and must not use `detached`.
 */
export const DETACH_PROCESS_GROUP = process.platform !== 'win32'

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null
}

function signalTree(child: ChildProcess, pid: number, force: boolean): void {
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/PID', String(pid), '/T', ...(force ? ['/F'] : [])], {
      stdio: 'ignore',
      windowsHide: true,
    })
    killer.unref()
    return
  }
  try {
    process.kill(-pid, force ? 'SIGKILL' : 'SIGTERM')
  } catch {
    // ESRCH: the group is already empty. EPERM/other: fall back to the leader.
    try { child.kill(force ? 'SIGKILL' : 'SIGTERM') } catch { /* already gone */ }
  }
}

export function terminateProcessTree(child: ChildProcess, force = false): void {
  if (!child.pid || hasExited(child)) return
  signalTree(child, child.pid, force)
}

/**
 * Stops a spawned tool and everything it started, then waits until the leader
 * has exited (bounded). The leader exiting on SIGTERM does not prove its
 * descendants are gone, so the group always receives a final SIGKILL sweep.
 */
export async function stopProcessTree(child: ChildProcess, graceMs = 3_000): Promise<void> {
  const pid = child.pid
  if (!pid) return
  let timer: ReturnType<typeof setTimeout> | null = null
  const exited = hasExited(child)
    ? Promise.resolve()
    : new Promise<void>((resolve) => { child.once('exit', () => resolve()) })
  const within = async (ms: number) => {
    await Promise.race([
      exited,
      new Promise<void>((resolve) => { timer = setTimeout(resolve, ms) }),
    ])
    if (timer) clearTimeout(timer)
  }
  if (process.platform === 'win32') {
    // Console tools ignore a polite taskkill, and Node's own kill() is already
    // forceful there; end the whole tree at once. A dead leader leaves nothing
    // addressable for /T.
    if (!hasExited(child)) signalTree(child, pid, true)
    await within(graceMs)
    return
  }
  if (!hasExited(child)) signalTree(child, pid, false)
  await within(graceMs)
  signalTree(child, pid, true)
  if (!hasExited(child)) await within(1_000)
}
