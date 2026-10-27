// @covers open-source/packages/cli/src/upgrade/updater-service-entry.ts
// @arch open-source/docs/cli-runtime.md
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { prepareRecoveryServiceEntry } from '../upgrade/updater-service-entry.js'
import type { UpdaterJob } from '../upgrade/updater-protocol.js'
const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })))

describe('stable service entry preparation', () => {
  it.each(['linux', 'darwin', 'win32'] as const)('updates only the owned %s service, without stopping or restarting it', (platform) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'updater service ')); roots.push(home)
    const directory = path.join(home, '.shennian')
    const job = { platform, jobId: 'job-1', npmPrefix: path.join(home, 'npm'), nodeExecutable: '/node',
      resultPath: path.join(directory, 'runtime/updater/results/job-1.json'), attemptPath: path.join(directory, 'upgrade-attempt.json') } as UpdaterJob
    const files = {
      linux: '.config/systemd/user/shennian.service', darwin: 'Library/LaunchAgents/com.shennian.agent.plist', win32: '.shennian/autostart.cmd',
    }
    const file = path.join(home, files[platform]); fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, platform === 'darwin'
      ? '<key>Label</key><string>com.shennian.agent</string><key>ProgramArguments</key><array><string>/shennian</string></array><key>KeepAlive</key><true/>'
      : platform === 'linux' ? '[Service]\nExecStart=/node /shennian run-service\nRestart=on-failure\n' : '@echo off\nold launcher')
    const run = vi.fn()
    prepareRecoveryServiceEntry(job, '/stable/updater-worker.js', { home, run: run as never })
    expect(fs.readFileSync(file, 'utf8')).toContain('--service')
    expect(fs.readFileSync(file, 'utf8')).toContain('run-service')
    if (platform === 'linux') expect(run).toHaveBeenCalledWith('systemctl', ['--user', 'daemon-reload'], expect.anything())
    else expect(run).not.toHaveBeenCalled()
  })
})
