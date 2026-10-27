// @arch open-source/docs/cli-runtime.md
// @test open-source/packages/cli/src/__tests__/updater-service-entry.test.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { buildWindowsLauncherCommand, escapeXml, quoteSystemdArg } from '../commands/daemon-windows.js'
import type { UpdaterJob } from './updater-protocol.js'
import { updaterPaths } from './updater-worker.js'

/** Update only this installation's service entry, without restarting the daemon. */
export function prepareRecoveryServiceEntry(job: UpdaterJob, workerPath: string, deps: {
  home?: string
  run?: typeof execFileSync
} = {}): void {
  if (job.isolatedDaemonStart) return
  const root = path.dirname(path.dirname(job.resultPath))
  const home = deps.home ?? os.homedir()
  const bin = path.join(updaterPaths(job).active, 'dist/bin/shennian.js')
  const args = [workerPath, '--service', root, bin, 'run-service']
  let file: string
  let transform: (original: string) => string
  if (job.platform === 'linux') {
    file = path.join(home, '.config/systemd/user/shennian.service')
    transform = (original) => {
      if (!/^ExecStart=.*(?:shennian|updater-worker)/m.test(original)) throw new Error('unsupported_service_entry')
      return original.replace(/^ExecStart=.*$/m, `ExecStart=${[job.nodeExecutable, ...args].map(quoteSystemdArg).join(' ')}`)
    }
  } else if (job.platform === 'darwin') {
    file = path.join(home, 'Library/LaunchAgents/com.shennian.agent.plist')
    transform = (original) => {
      if (!original.includes('com.shennian.agent') || !/<key>ProgramArguments<\/key>\s*<array>[\s\S]*?<\/array>/.test(original)) {
        throw new Error('unsupported_service_entry')
      }
      return original.replace(/(<key>ProgramArguments<\/key>\s*)<array>[\s\S]*?<\/array>/,
        `$1<array>${[job.nodeExecutable, ...args].map((arg) => `<string>${escapeXml(arg)}</string>`).join('')}</array>`)
    }
  } else {
    file = path.join(path.dirname(job.attemptPath), 'autostart.cmd')
    transform = () => buildWindowsLauncherCommand({ command: job.nodeExecutable, args }, path.join(path.dirname(job.attemptPath), 'daemon.log'))
  }
  if (!fs.existsSync(file)) return // No installed service: detached CLI start remains supported.
  if (fs.lstatSync(file).isSymbolicLink()) throw new Error('unsafe_service_entry')
  const original = fs.readFileSync(file, 'utf8')
  const updated = transform(original)
  if (updated === original) return
  const temp = `${file}.upgrade-${job.jobId}`
  try {
    fs.writeFileSync(temp, updated, { flag: 'wx', mode: fs.statSync(file).mode & 0o777 })
    const fd = fs.openSync(temp, job.platform === 'win32' ? 'r+' : 'r')
    try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
    fs.renameSync(temp, file)
    if (job.platform === 'linux') {
      (deps.run ?? execFileSync)('systemctl', ['--user', 'daemon-reload'], { stdio: 'pipe', timeout: 15_000 })
    }
  } finally {
    try { fs.unlinkSync(temp) } catch { /* already renamed */ }
  }
}
