// @covers open-source/packages/cli/src/upgrade/updater-worker.ts
// @arch open-source/docs/cli-runtime.md

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { prepareUpdaterCandidate, recoverServiceEntry, runUpdaterJob, updaterPaths, verifyLocalPackage } from '../upgrade/updater-worker.js'
import { markUpdaterHealthy } from '../upgrade/updater-launcher.js'
import type { UpdaterJob } from '../upgrade/updater-protocol.js'

const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })))

function json(file: string, value?: unknown): any {
  if (value === undefined) return JSON.parse(fs.readFileSync(file, 'utf8'))
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(value))
}

function packageTree(directory: string, version: string) {
  fs.mkdirSync(path.join(directory, 'dist/bin'), { recursive: true })
  fs.writeFileSync(path.join(directory, 'dist/bin/shennian.js'), `// ${version}\n`, { mode: 0o755 })
  json(path.join(directory, 'package.json'), {
    name: 'shennian', version, bin: { shennian: 'dist/bin/shennian.js' }, dependencies: { 'demo-dep': '1.0.0' },
  })
  json(path.join(directory, 'node_modules/demo-dep/package.json'), { name: 'demo-dep', version: '1.0.0' })
  fs.writeFileSync(path.join(directory, 'node_modules/demo-dep/index.js'), 'complete dependency')
}

function fixture(patch: Partial<UpdaterJob> = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-updater-worker-'))
  roots.push(home)
  const root = path.join(home, 'runtime/updater')
  const jobPath = path.join(root, 'jobs/job-1.json')
  const job: UpdaterJob = {
    protocolVersion: 1, jobId: 'job-1', fromVersion: '1.0.0', targetVersion: '1.0.1', operation: 'upgrade',
    npmPrefix: path.join(home, 'npm prefix'), npmExecutable: 'npm', nodeExecutable: '/node',
    packageName: 'shennian', oldDaemonPid: null, platform: 'darwin',
    createdAt: new Date().toISOString(), daemonExitTimeoutMs: 1000, commandTimeoutMs: 10_000,
    resultPath: path.join(root, 'results/job-1.json'), attemptPath: path.join(home, 'upgrade-attempt.json'),
    ...patch,
  }
  json(jobPath, job)
  const paths = updaterPaths(job)
  packageTree(paths.active, job.fromVersion)
  let now = Date.now()
  const state = {
    installFails: false,
    registryInstallFails: false,
    candidateInvalid: false,
    switchInvalid: false,
    targetUnhealthy: false,
  }
  const run = vi.fn(async (command: string, args: string[]) => {
    if (command === 'npm' && args[0] === 'install') {
      const registryInstall = args.some((arg) => arg === `shennian@${job.targetVersion}`)
      if (state.installFails || (registryInstall && state.registryInstallFails)) throw new Error('network_timeout')
      // Never allow the implementation to install into the live global prefix.
      expect(args[args.indexOf('--prefix') + 1]).toBe(paths.prefix)
      packageTree(paths.candidate, state.candidateInvalid ? '0.0.0' : job.targetVersion)
    }
    if (command === '/node' && args.includes('--version')) {
      const version = json(path.resolve(args[0], '../../../package.json')).version
      return { stdout: state.switchInvalid && args[0].startsWith(paths.active) && version === job.targetVersion ? 'wrong' : version + '\n', stderr: '' }
    }
    if (args[0] === 'kickstart' || args[0] === '/Run' || args.includes('restart') || args.includes('start')) {
      const version = json(path.join(paths.active, 'package.json')).version
      if (!(state.targetUnhealthy && version === job.targetVersion)) {
        markUpdaterHealthy(job.jobId, version, root)
      }
    }
    return { stdout: '', stderr: '' }
  })
  const deps = {
    execFile: run as never, now: () => now, healthTimeoutMs: 1000,
    sleep: async (ms: number) => { now += ms },
  }
  return { home, root, job, jobPath, paths, state, run, deps }
}

describe('offline transactional updater', () => {
  it('uses the same verified transaction and rollback snapshot for an explicit downgrade', async () => {
    const f = fixture({ fromVersion: '1.0.1', targetVersion: '1.0.0', isolatedDaemonStart: true })
    await prepareUpdaterCandidate(f.job, f.deps)
    await runUpdaterJob(f.jobPath, f.deps)
    expect(json(f.job.resultPath)).toMatchObject({ state: 'healthy', targetVersion: '1.0.0' })
    verifyLocalPackage(f.paths.active, '1.0.0')
    verifyLocalPackage(f.paths.previous, '1.0.1')
  })

  it('remains self-contained outside the replaceable package', () => {
    const source = fs.readFileSync(new URL('../upgrade/updater-worker.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(/from\s+['"]\.\.?\//)
    expect(source).not.toMatch(/dotenv|\.env(?:\W|$)/i)
    expect(source).not.toMatch(/(?:^|['"/])(?:session|room|agents)\//i)
  })

  it('prepares complete dependencies while the old package and daemon are untouched', async () => {
    const f = fixture({ oldDaemonPid: 99 })
    const kill = vi.fn()
    const fetchOwnedArtifact = vi.fn()
    await prepareUpdaterCandidate(f.job, { ...f.deps, kill, fetchOwnedArtifact })
    expect(json(path.join(f.paths.active, 'package.json')).version).toBe('1.0.0')
    expect(fs.readFileSync(path.join(f.paths.candidate, 'node_modules/demo-dep/index.js'), 'utf8')).toBe('complete dependency')
    expect(kill).not.toHaveBeenCalled()
    expect(fetchOwnedArtifact).not.toHaveBeenCalled()
    expect(f.run.mock.calls.every(([command]) => command === 'npm' || command === '/node')).toBe(true)
  })

  it('falls back to a freshly authorized OSS tarball after both npm attempts fail', async () => {
    const bytes = Buffer.from('self-contained-cli-artifact')
    const integrity = `sha512-${crypto.createHash('sha512').update(bytes).digest('base64')}`
    const f = fixture()
    f.state.registryInstallFails = true
    const fetchOwnedArtifact = vi.fn(async () => ({
      url: 'https://oss.example/shennian.tgz', size: bytes.byteLength, integrity,
    }))
    const fetcher = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => bytes })
    await prepareUpdaterCandidate(f.job, { ...f.deps, fetch: fetcher as never, fetchOwnedArtifact })
    expect(fetchOwnedArtifact).toHaveBeenCalledWith(f.job.targetVersion)
    const installs = f.run.mock.calls.filter(([, args]) => args[0] === 'install')
    expect(installs).toHaveLength(3)
    const install = installs[2]
    expect(install?.[1]).toEqual(expect.arrayContaining(['--offline', '--ignore-scripts', '--no-audit', '--no-fund']))
    expect(install?.[1].some((arg: string) => arg.endsWith('.tgz'))).toBe(true)
    expect(install?.[1]).not.toContain('--registry')
  })

  it('supports an explicit OSS-first switch for local fallback testing', async () => {
    const bytes = Buffer.from('self-contained-cli-artifact')
    const integrity = `sha512-${crypto.createHash('sha512').update(bytes).digest('base64')}`
    const f = fixture()
    await prepareUpdaterCandidate(f.job, {
      ...f.deps,
      sourceOrder: 'oss-first',
      fetchOwnedArtifact: async () => ({
        url: 'https://oss.example/shennian.tgz', size: bytes.byteLength, integrity,
      }),
      fetch: vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => bytes }) as never,
    })
    const installs = f.run.mock.calls.filter(([, args]) => args[0] === 'install')
    expect(installs).toHaveLength(1)
    expect(installs[0][1].some((arg: string) => arg.endsWith('.tgz'))).toBe(true)
  })

  it('download failure leaves the running old daemon and installation alone', async () => {
    const f = fixture({ oldDaemonPid: 99 }); f.state.installFails = true
    const kill = vi.fn()
    await runUpdaterJob(f.jobPath, { ...f.deps, kill, isAlive: () => true })
    expect(kill).not.toHaveBeenCalled()
    expect(json(f.job.resultPath)).toMatchObject({ state: 'failed', errorCode: 'candidate_preparation_failed' })
    expect(json(path.join(f.paths.active, 'package.json')).version).toBe('1.0.0')
    expect(f.run.mock.calls.filter(([, args]) => args[0] === 'install')).toHaveLength(2)
    expect(f.run.mock.calls.every(([, args]) => !args.includes('shennian@1.0.0'))).toBe(true)
  })

  it('restarts the untouched old install when a legacy launcher already exited', async () => {
    const f = fixture(); f.state.installFails = true
    await runUpdaterJob(f.jobPath, f.deps)
    expect(f.run).toHaveBeenCalledWith('launchctl', expect.arrayContaining(['kickstart']), expect.anything())
    expect(json(f.job.resultPath).state).toBe('failed') // no fabricated rollback health
  })

  it('candidate verification fails before stopping or moving the old installation', async () => {
    const f = fixture({ oldDaemonPid: 99 }); f.state.candidateInvalid = true
    const kill = vi.fn()
    await runUpdaterJob(f.jobPath, { ...f.deps, kill, isAlive: () => true })
    expect(kill).not.toHaveBeenCalled()
    expect(fs.existsSync(f.paths.previous)).toBe(false)
    expect(json(path.join(f.paths.active, 'package.json')).version).toBe('1.0.0')
  })

  it.each(['darwin', 'linux'] as const)('switches a prepared install and waits for daemon-owned health on %s', async (platform) => {
    const f = fixture({ platform })
    await prepareUpdaterCandidate(f.job, f.deps)
    f.run.mockClear(); f.state.installFails = true // npm is unavailable from here onward
    await runUpdaterJob(f.jobPath, f.deps)
    expect(json(f.job.resultPath).state).toBe('healthy')
    expect(json(path.join(f.paths.previous, 'package.json')).version).toBe('1.0.0')
    expect(json(path.join(f.paths.active, 'package.json')).version).toBe('1.0.1')
    expect(f.run.mock.calls.some(([, args]) => args[0] === 'install')).toBe(false)
  })

  it('uses local previous dependencies after post-switch verification failure, with npm completely unavailable', async () => {
    const f = fixture()
    await prepareUpdaterCandidate(f.job, f.deps)
    f.run.mockClear(); f.state.installFails = true; f.state.switchInvalid = true
    await runUpdaterJob(f.jobPath, f.deps)
    expect(json(f.job.resultPath)).toMatchObject({ state: 'rolled_back', effectiveVersion: '1.0.0' })
    expect(json(f.job.attemptPath)).toMatchObject({ from: '1.0.1', to: '1.0.0', operation: 'rollback' })
    verifyLocalPackage(f.paths.active, '1.0.0')
    expect(f.run.mock.calls.some(([, args]) => args[0] === 'install')).toBe(false)
  })

  it('does not treat a successful service start as health, and rolls back on timeout', async () => {
    const f = fixture(); f.state.targetUnhealthy = true
    await runUpdaterJob(f.jobPath, f.deps)
    expect(json(f.job.resultPath).state).toBe('rolled_back')
    expect(json(path.join(f.paths.active, 'package.json')).version).toBe('1.0.0')
  })

  it('never overwrites an unkillable old daemon installation', async () => {
    const f = fixture({ oldDaemonPid: 99 })
    const kill = vi.fn()
    await runUpdaterJob(f.jobPath, { ...f.deps, kill, isAlive: () => true })
    expect(kill.mock.calls.map(([, signal]) => signal)).toEqual(['SIGTERM', 'SIGKILL'])
    expect(json(f.job.resultPath).errorCode).toBe('daemon_exit_timeout')
    expect(fs.existsSync(f.paths.previous)).toBe(false)
    verifyLocalPackage(f.paths.active, '1.0.0')
  })

  it.each(['before_old_rename', 'after_old_rename', 'after_candidate_rename', 'during_restore', 'after_restore'])('recovers a crash %s without installing or starting a second daemon', async (point) => {
    const f = fixture()
    await prepareUpdaterCandidate(f.job, f.deps)
    if (point !== 'before_old_rename') fs.renameSync(f.paths.active, f.paths.previous)
    if (['after_candidate_rename', 'during_restore', 'after_restore'].includes(point)) fs.renameSync(f.paths.candidate, f.paths.active)
    if (['during_restore', 'after_restore'].includes(point)) fs.renameSync(f.paths.active, f.paths.rejected)
    if (point === 'after_restore') fs.renameSync(f.paths.previous, f.paths.active)
    json(f.paths.marker, { ...json(f.paths.marker), phase: ['during_restore', 'after_restore'].includes(point) ? 'rolling_back' : 'switching' })
    json(path.join(f.root, 'active-job.json'), { jobPath: f.jobPath })
    f.run.mockClear()
    await runUpdaterJob(f.jobPath, { ...f.deps, serviceRecovery: true })
    verifyLocalPackage(f.paths.active, '1.0.0')
    expect(json(f.job.resultPath)).toMatchObject({ state: 'starting', operation: 'rollback' })
    expect(f.run.mock.calls.some(([, args]) => args[0] === 'install' || args[0] === 'kickstart')).toBe(false)
  })

  it('retains a corrupted old snapshot and reports failed recovery rather than installing over it', async () => {
    const f = fixture()
    await prepareUpdaterCandidate(f.job, f.deps)
    fs.renameSync(f.paths.active, f.paths.previous)
    fs.renameSync(f.paths.candidate, f.paths.active)
    fs.unlinkSync(path.join(f.paths.previous, 'node_modules/demo-dep/package.json'))
    json(f.paths.marker, { ...json(f.paths.marker), phase: 'starting' })
    await expect(runUpdaterJob(f.jobPath, { ...f.deps, serviceRecovery: true })).rejects.toThrow()
    expect(json(f.job.resultPath).errorCode).toBe('rollback_failed')
    expect(fs.existsSync(f.paths.previous)).toBe(true)
  })

  it('refuses incomplete snapshots and escaping symlinks before preparing', async () => {
    const f = fixture()
    fs.symlinkSync(f.home, path.join(f.paths.active, 'outside'))
    await expect(prepareUpdaterCandidate(f.job, f.deps)).rejects.toThrow('external_package_dependency')
    expect(f.run).not.toHaveBeenCalled()
  })

  it('keeps pairing and personal data untouched', async () => {
    const f = fixture(); f.state.targetUnhealthy = true
    json(path.join(f.home, 'config.json'), { machineId: 'unchanged' })
    fs.writeFileSync(path.join(f.home, 'personal.sqlite'), 'personal data')
    await runUpdaterJob(f.jobPath, f.deps)
    expect(json(path.join(f.home, 'config.json'))).toEqual({ machineId: 'unchanged' })
    expect(fs.readFileSync(path.join(f.home, 'personal.sqlite'), 'utf8')).toBe('personal data')
  })

  it('does not stop the daemon if the launcher never acknowledges readiness', async () => {
    const f = fixture({ requireHandoffAck: true, oldDaemonPid: 99 })
    const kill = vi.fn()
    await runUpdaterJob(f.jobPath, { ...f.deps, kill, isAlive: () => true })
    expect(kill).not.toHaveBeenCalled()
    expect(json(f.job.resultPath).errorCode).toBe('handoff_not_confirmed')
    verifyLocalPackage(f.paths.active, '1.0.0')
  })

  it('adopts a handed-off lock from a live non-daemon launcher exactly once', async () => {
    const f = fixture()
    json(path.join(f.root, 'updater.lock'), { jobId: f.job.jobId, phase: 'handoff', pid: process.pid, createdAt: Date.now() })
    await runUpdaterJob(f.jobPath, f.deps)
    expect(json(f.job.resultPath).state).toBe('healthy')
    json(path.join(f.root, 'updater.lock'), { jobId: f.job.jobId, phase: 'worker', pid: process.pid, createdAt: Date.now() })
    await expect(runUpdaterJob(f.jobPath, f.deps)).rejects.toThrow('upgrade_locked')
  })

  it('does not repeat a terminal job or accept an active marker outside jobs/', async () => {
    const f = fixture()
    json(f.job.resultPath, { jobId: f.job.jobId, state: 'healthy' })
    await runUpdaterJob(f.jobPath, f.deps)
    expect(f.run).not.toHaveBeenCalled()
    json(path.join(f.root, 'active-job.json'), { jobPath: path.join(f.home, 'other.json') })
    await expect(recoverServiceEntry(f.root)).rejects.toThrow('invalid_job')
  })
})
