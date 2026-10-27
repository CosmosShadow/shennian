// @arch open-source/docs/cli-runtime.md
// @covers src/agents/process-tree.ts

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { DETACH_PROCESS_GROUP, stopProcessTree } from '../agents/process-tree.js'

const posix = process.platform !== 'win32'
const spawned: number[] = []

function alive(pid: number): boolean {
  try { process.kill(pid, 0) } catch { return false }
  // An unreaped zombie still answers signal 0 but is not running anything.
  return !spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim().startsWith('Z')
}

async function waitUntilDead(pid: number, timeoutMs = 3_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!alive(pid)) return true
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  return !alive(pid)
}

// The leader prints its background child's pid, then behaves as `leaderTail` says.
async function startTree(script: string): Promise<{ leader: ChildProcess; descendant: number }> {
  const leader = spawn('sh', ['-c', script], { stdio: ['ignore', 'pipe', 'ignore'], detached: DETACH_PROCESS_GROUP })
  const descendant = await new Promise<number>((resolve, reject) => {
    let out = ''
    leader.stdout!.on('data', (chunk) => {
      out += chunk
      const pid = Number.parseInt(out.trim(), 10)
      if (out.includes('\n') && Number.isFinite(pid)) resolve(pid)
    })
    leader.once('error', reject)
    leader.once('exit', () => reject(new Error('leader exited before reporting its child')))
  })
  spawned.push(leader.pid!, descendant)
  return { leader, descendant }
}

afterEach(() => {
  for (const pid of spawned.splice(0)) {
    try { process.kill(-pid, 'SIGKILL') } catch { /* gone */ }
    try { process.kill(pid, 'SIGKILL') } catch { /* gone */ }
  }
})

describe.skipIf(!posix)('stopProcessTree', () => {
  it('ends a descendant that a plain SIGTERM to the leader would orphan', async () => {
    const { leader, descendant } = await startTree('sleep 300 & echo $!; wait')

    await stopProcessTree(leader)

    expect(leader.exitCode !== null || leader.signalCode !== null).toBe(true)
    expect(await waitUntilDead(descendant)).toBe(true)
  })

  it('force-kills a tree whose members ignore SIGTERM after the grace period', async () => {
    const { leader, descendant } = await startTree("trap '' TERM; (trap '' TERM; exec sleep 300) & echo $!; while true; do sleep 1; done")

    const started = Date.now()
    await stopProcessTree(leader, 200)

    expect(Date.now() - started).toBeLessThan(2_500)
    expect(await waitUntilDead(leader.pid!)).toBe(true)
    expect(await waitUntilDead(descendant)).toBe(true)
  })

  it('sweeps a descendant that outlives a leader which exits on SIGTERM', async () => {
    const { leader, descendant } = await startTree("(trap '' TERM; exec sleep 300) & echo $!; wait")

    await stopProcessTree(leader)

    expect(await waitUntilDead(descendant)).toBe(true)
  })

  it('returns immediately for a process that already exited', async () => {
    const leader = spawn('sh', ['-c', 'exit 0'], { stdio: 'ignore', detached: DETACH_PROCESS_GROUP })
    await new Promise((resolve) => leader.once('exit', resolve))

    const started = Date.now()
    await stopProcessTree(leader, 5_000)

    expect(Date.now() - started).toBeLessThan(1_000)
  })
})
