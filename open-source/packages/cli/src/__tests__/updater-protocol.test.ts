// @covers open-source/packages/cli/src/upgrade/updater-protocol.ts

import { describe, expect, it } from 'vitest'
import { parseUpdaterJob, sanitizeUpdaterError } from '../upgrade/updater-protocol.js'

const valid = {
  protocolVersion: 1, jobId: 'job-1', fromVersion: '1.2.3', targetVersion: '1.2.4',
  npmPrefix: '/opt/npm', npmExecutable: 'npm', nodeExecutable: '/usr/bin/node',
  packageName: 'shennian', oldDaemonPid: 123, platform: 'darwin',
  createdAt: '2026-09-09T00:00:00.000Z', daemonExitTimeoutMs: 15_000,
  commandTimeoutMs: 120_000, resultPath: '/tmp/result.json', attemptPath: '/tmp/attempt.json',
} as const

describe('updater protocol', () => {
  it('accepts one exact versioned job schema', () => {
    expect(parseUpdaterJob(valid)).toMatchObject({ jobId: 'job-1', targetVersion: '1.2.4' })
  })

  it('rejects shell-shaped versions and unknown protocols', () => {
    expect(() => parseUpdaterJob({ ...valid, targetVersion: '1.2.4; rm -rf /' })).toThrow('invalid_job')
    expect(() => parseUpdaterJob({ ...valid, protocolVersion: 2 })).toThrow('invalid_job')
  })

  it('redacts paths and credential-shaped output', () => {
    const text = sanitizeUpdaterError(new Error('token=abc123 failed at /Users/me/private/file'))
    expect(text).not.toContain('abc123')
    expect(text).not.toContain('/Users/me')
  })
})
