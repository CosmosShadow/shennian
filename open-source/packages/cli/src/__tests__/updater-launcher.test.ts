// @covers open-source/packages/cli/src/upgrade/updater-launcher.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createUpdaterJob, launchUpdater, markUpdaterHealthy, needsSystemdUpdater } from '../upgrade/updater-launcher.js'

const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })))

describe('updater launcher', () => {
  it('marks Docker jobs for direct daemon restart without touching systemd', () => {
    vi.stubEnv('SHENNIAN_DAEMON_SUPERVISOR', 'docker')
    try {
      expect(createUpdaterJob({ fromVersion: '1.0.0', targetVersion: '1.0.1', oldDaemonPid: 5, npmPrefix: '/data/cli' }).isolatedDaemonStart).toBe(true)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('escapes only the Linux daemon service cgroup, not ordinary detached processes', () => {
    expect(needsSystemdUpdater('linux', '0::/user.slice/user-0.slice/user@0.service/app.slice/shennian.service\n')).toBe(true)
    expect(needsSystemdUpdater('linux', '0::/user.slice/session-5.scope')).toBe(false)
    expect(needsSystemdUpdater('darwin', '/shennian.service')).toBe(false)
  })

  it('persists the job before spawning a detached external worker', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-updater-launch-'))
    roots.push(root)
    const workerPath = path.join(root, 'worker.js')
    fs.writeFileSync(workerPath, '')
    const unref = vi.fn()
    const spawn = vi.fn(() => ({ unref } as never))
    const { job } = launchUpdater({
      fromVersion: '1.0.0', targetVersion: '1.0.1', oldDaemonPid: 42,
      npmPrefix: path.join(root, 'npm'), nodeExecutable: '/node', npmExecutable: 'npm',
      root, jobId: 'job-1',
    }, {
      root, spawn: spawn as never,
      readiness: { protocolVersion: 1, workerPath, installedAt: new Date(0).toISOString() },
    })
    const jobPath = path.join(root, 'jobs', 'job-1.json')
    expect(JSON.parse(fs.readFileSync(jobPath, 'utf8'))).toMatchObject({ targetVersion: '1.0.1' })
    expect(spawn).toHaveBeenCalledWith('/node', [workerPath, jobPath], expect.objectContaining({ detached: true }))
    expect(unref).toHaveBeenCalledOnce()
    expect(job.resultPath).toBe(path.join(root, 'results', 'job-1.json'))
    expect(JSON.parse(fs.readFileSync(path.join(root, 'updater.lock'), 'utf8'))).toMatchObject({ jobId: 'job-1' })
    expect(() => launchUpdater({
      fromVersion: '1.0.0', targetVersion: '1.0.2', oldDaemonPid: 42,
      npmPrefix: path.join(root, 'npm'), nodeExecutable: '/node', npmExecutable: 'npm', root,
    }, {
      root, spawn: spawn as never,
      readiness: { protocolVersion: 1, workerPath, installedAt: new Date(0).toISOString() },
    })).toThrow()
    expect(JSON.parse(fs.readFileSync(path.join(root, 'updater.lock'), 'utf8'))).toMatchObject({ jobId: 'job-1' })
    expect(fs.readdirSync(path.join(root, 'jobs'))).toEqual(['job-1.json'])
  })

  it('hands off to a sibling systemd unit and never falls back after a rejected handoff', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-updater-unit-'))
    roots.push(root)
    const spawn = vi.fn()
    const systemdRun = vi.fn(() => ({ status: 0 }))
    const input = { fromVersion: '1.0.0', targetVersion: '1.0.1', oldDaemonPid: 42, npmPrefix: '/usr/local', root, jobId: 'unit-job' }
    const deps = { root, spawn: spawn as never, platform: 'linux' as const, serviceCgroup: '0::/app.slice/shennian.service', systemdRun: systemdRun as never, readiness: { protocolVersion: 1 as const, workerPath: '/worker.js', installedAt: new Date().toISOString() } }
    expect(launchUpdater(input, deps).process).toBeNull()
    expect(systemdRun).toHaveBeenCalledWith('systemd-run', expect.arrayContaining(['--user', '--unit=shennian-updater-unit-job', '--property=Type=exec', '/worker.js']), expect.objectContaining({ timeout: 10_000 }))
    expect(spawn).not.toHaveBeenCalled()
    // A failed manager handoff releases only this job's lock and surfaces failure.
    fs.unlinkSync(path.join(root, 'updater.lock'))
    systemdRun.mockReturnValue({ status: 1 })
    expect(() => launchUpdater({ ...input, jobId: 'failed-unit' }, deps)).toThrow('updater_service_launch_failed')
    expect(fs.existsSync(path.join(root, 'updater.lock'))).toBe(false)
    expect(spawn).not.toHaveBeenCalled()
  })

  it('lets only the reconciled replacement daemon commit healthy', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-updater-healthy-'))
    roots.push(root)
    const resultPath = path.join(root, 'results', 'job-1.json')
    fs.mkdirSync(path.dirname(resultPath), { recursive: true })
    fs.writeFileSync(resultPath, JSON.stringify({
      protocolVersion: 1,
      jobId: 'job-1',
      state: 'starting',
      fromVersion: '1.0.0',
      targetVersion: '1.0.1',
      updatedAt: new Date(0).toISOString(),
    }))
    expect(markUpdaterHealthy('job-1', '1.0.1', root)).toBe(true)
    expect(JSON.parse(fs.readFileSync(resultPath, 'utf8'))).toMatchObject({
      state: 'healthy', effectiveVersion: '1.0.1',
    })
    expect(markUpdaterHealthy('../escape', '1.0.1', root)).toBe(false)
  })

  it('reclaims a stale updater lock but preserves a live lock', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-updater-stale-lock-'))
    roots.push(root)
    const workerPath = path.join(root, 'worker.js')
    fs.writeFileSync(workerPath, '')
    fs.writeFileSync(path.join(root, 'updater.lock'), JSON.stringify({
      jobId: 'old', pid: 999, createdAt: 0,
    }))
    const unref = vi.fn()
    const spawn = vi.fn(() => ({ unref } as never))
    expect(() => launchUpdater({
      fromVersion: '1.0.0', targetVersion: '1.0.1', oldDaemonPid: null,
      npmPrefix: path.join(root, 'npm'), nodeExecutable: '/node', npmExecutable: 'npm',
      root, jobId: 'replacement',
    }, {
      root, spawn: spawn as never, now: () => 31 * 60_000, isAlive: () => false,
      readiness: { protocolVersion: 1, workerPath, installedAt: new Date(0).toISOString() },
    })).not.toThrow()
    expect(JSON.parse(fs.readFileSync(path.join(root, 'updater.lock'), 'utf8'))).toMatchObject({
      jobId: 'replacement',
    })
  })
})
