// @covers open-source/packages/server/src/worker-runtime.ts

import { describe, expect, it, vi } from 'vitest'
import { startWorkerRuntime, type WorkerRuntimeDependencies } from '../worker-runtime.js'

describe('worker runtime', () => {
  it('runs startup before jobs and stops started jobs in reverse order exactly once', async () => {
    const calls: string[] = []
    const dependencies: WorkerRuntimeDependencies = {
      startup: vi.fn(async () => { calls.push('startup') }),
      jobs: ['first', 'second'].map((name) => ({
        name,
        start: vi.fn(() => { calls.push(`start:${name}`) }),
        stop: vi.fn(async () => { calls.push(`stop:${name}`) }),
      })),
    }

    const runtime = await startWorkerRuntime(dependencies)
    expect(runtime.jobNames).toEqual(['first', 'second'])
    expect(calls).toEqual(['startup', 'start:first', 'start:second'])

    await runtime.stop()
    await runtime.stop()
    expect(calls).toEqual([
      'startup',
      'start:first',
      'start:second',
      'stop:second',
      'stop:first',
    ])
  })

  it('stops already-started jobs if a later job fails to start', async () => {
    const stopFirst = vi.fn(async () => undefined)
    const dependencies: WorkerRuntimeDependencies = {
      startup: vi.fn(async () => undefined),
      jobs: [
        { name: 'first', start: vi.fn(), stop: stopFirst },
        {
          name: 'broken',
          start: () => { throw new Error('broken') },
          stop: vi.fn(),
        },
      ],
    }

    await expect(startWorkerRuntime(dependencies)).rejects.toThrow('broken')
    expect(stopFirst).toHaveBeenCalledOnce()
  })
})
