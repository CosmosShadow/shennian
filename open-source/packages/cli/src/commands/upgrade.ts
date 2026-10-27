// @arch open-source/docs/cli-runtime.md
// @test open-source/packages/cli/src/__tests__/upgrade-command.test.ts

import chalk from 'chalk'
import { execSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import { createInterface } from 'node:readline/promises'
import type { Command } from 'commander'
import {
  getCurrentVersion,
  fetchLatestVersion,
  compareVersions,
  checkForUpdate,
  acquireUpgradeLock,
  recordUpgradeFailure,
} from '../upgrade/engine.js'
import type { CliRelayClient } from '../relay/client.js'
import { callDaemonIpc } from '../daemon-ipc/client.js'
import { getDaemonStatus } from './daemon.js'
import { ensureUpdaterInstalled } from '../upgrade/updater-bootstrap.js'
import { launchUpdater, createUpdaterJob, waitForUpdaterReady, confirmUpdaterHandoff } from '../upgrade/updater-launcher.js'

import { prepareRecoveryServiceEntry } from '../upgrade/updater-service-entry.js'
import { resolveShennianPath } from '../config/index.js'
import { assertUpdaterAvailable, prepareUpdaterCandidate } from '../upgrade/updater-worker.js'

import { getUpgradeChannel, setUpgradeChannel } from '../upgrade/channel.js'
import { fetchOwnedCliArtifact, getCliUpdateSourceOrder } from '../upgrade/distribution.js'

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

type RestartAfterUpgradeDeps = {
  platform?: NodeJS.Platform
  kill?: typeof process.kill
  pid?: number
  spawn?: typeof spawn
  execSync?: typeof execSync
  env?: NodeJS.ProcessEnv
}

export function hasMajorUpgradeConfirmation(
  changeType: ReturnType<typeof compareVersions>,
  confirmed: boolean,
): boolean {
  return changeType !== 'major' || confirmed
}

export function classifyBidirectionalVersionChange(current: string, target: string): ReturnType<typeof compareVersions> {
  const upgrade = compareVersions(current, target)
  return upgrade === 'none' && current !== target ? compareVersions(target, current) : upgrade
}

export function restartCurrentDaemonAfterUpgrade(deps: RestartAfterUpgradeDeps = {}): void {
  const platform = deps.platform ?? os.platform()
  const kill = deps.kill ?? process.kill
  const currentPid = deps.pid ?? process.pid
  const env = deps.env ?? process.env
  const spawnFn = deps.spawn ?? spawn
  const execSyncFn = deps.execSync ?? execSync

  if (platform === 'win32') {
    const command = env.ComSpec || 'cmd.exe'

    try {
      const child = spawnFn(command, [
        '/d',
        '/s',
        '/c',
        'timeout /t 2 /nobreak >nul & schtasks /Run /TN ShennianAgent >nul',
      ], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      })
      child.unref()
      kill(currentPid, 'SIGTERM')
      return
    } catch {
      try {
        execSyncFn('schtasks /run /tn "ShennianAgent"', { stdio: 'pipe', windowsHide: true })
      } catch {
        // Fall through to process exit; manual start/status still works.
      }
    }
  } else {
    try {
      const child = spawnFn('sh', ['-c', 'sleep 2; shennian start >/dev/null 2>&1'], {
        detached: true,
        stdio: 'ignore',
        env,
      })
      child.unref()
    } catch {
      // launchd/systemd may still restart this process; otherwise manual start/status still works.
    }
  }

  kill(currentPid, 'SIGTERM')
}

// ─── Interactive CLI upgrade command ─────────────────────────────────────────

export function registerUpgradeCommand(program: Command): void {
  program
    .command('upgrade')
    .description('Upgrade Shennian CLI, or select an older version with --to')
    .option('--channel <channel>', 'Persist stable (npm latest) or preview (npm next); does not install')
    .option('--check', 'Only check for updates, do not install')
    .option('--to <version>', 'Upgrade to a specific version')
    .option('--yes', 'Confirm a major version change (required in non-interactive environments)')
    .action(async (opts: { check?: boolean; to?: string; yes?: boolean; channel?: string }) => {
      if (opts.channel !== undefined) {
        if (opts.to || opts.yes) throw new Error('--channel cannot be combined with --to or --yes')
        setUpgradeChannel(opts.channel)
        console.log(`Upgrade channel: ${getUpgradeChannel()} (saved; no installation)`)
        if (!opts.check) return
      }
      console.log(`Upgrade channel: ${getUpgradeChannel()}`)
      const current = getCurrentVersion()
      console.log(chalk.gray(`Current version: ${current}`))
      console.log()

      let spinIdx = 0
      const spinTimer = setInterval(() => {
        process.stdout.write(`\r  ${SPINNER[spinIdx % SPINNER.length]} Checking for updates...`)
        spinIdx++
      }, 80)

      let latest: string
      try {
        latest = opts.to ?? await fetchLatestVersion()
        clearInterval(spinTimer)
        process.stdout.write('\r' + ' '.repeat(40) + '\r')
      } catch (err) {
        clearInterval(spinTimer)
        process.stdout.write('\r' + ' '.repeat(40) + '\r')
        console.error(chalk.red(`✗ Failed to check for updates: ${err instanceof Error ? err.message : String(err)}`))
        process.exit(1)
      }

      const changeType = classifyBidirectionalVersionChange(current, latest)

      if (changeType === 'none' && !opts.to) {
        console.log(chalk.green(`✓ Already up to date (${current})`))
        return
      }

      console.log(`  Available: ${chalk.green(latest)} ${changeType === 'major' ? chalk.red('(major)') : changeType === 'minor' ? chalk.yellow('(minor)') : chalk.green('(patch)')}`)
      console.log()

      if (opts.check) return

      if (changeType === 'major') {
        console.log(chalk.yellow('  ⚠ This is a major version change and may contain breaking changes.'))
        console.log(chalk.gray('    Please review the changelog before upgrading.'))
        console.log()
        if (!opts.yes) {
          if (!process.stdin.isTTY || !process.stdout.isTTY) {
            console.error(chalk.red('✗ Major version changes require explicit confirmation; rerun with --yes.'))
            process.exit(1)
          }
          const prompt = createInterface({ input: process.stdin, output: process.stdout })
          const answer = await prompt.question(`  Type ${latest} to confirm this major upgrade: `)
          prompt.close()
          if (answer.trim() !== latest) {
            console.log(chalk.gray('  Upgrade cancelled.'))
            return
          }
        }
      }

      try {
        await callDaemonIpc({
          method: 'upgrade.start',
          params: { targetVersion: latest, confirmedMajor: changeType === 'major' || opts.yes === true },
          timeoutMs: 10_000,
        })
      } catch (error) {
        // With no daemon there can be no active Shennian-owned Run to freeze.
        // With no daemon, prepare the complete candidate in this process so a
        // private fallback URL never has to be persisted in the updater job.
        const status = getDaemonStatus({ cleanupStale: true })
        if (status.running) {
          const ipcCode = error && typeof error === 'object' && 'code' in error ? error.code : null
          if (process.platform === 'win32' && ipcCode === 'ipc_access_denied' &&
            status.daemonVersion && compareVersions(status.daemonVersion, '0.5.12') !== 'none') {
            throw new Error(
              'legacy_s4u_migration_required: The older Windows daemon is running in an inaccessible S4U session. '
              + 'The upgrade was not scheduled; inspect shennian status --json and request assisted migration. '
              + 'Do not force-stop the daemon.',
              { cause: error },
            )
          }
          throw new Error(
            'A Shennian daemon process is running, but its local control IPC did not accept the upgrade. '
            + 'Run shennian status --json and inspect ipc.state, the Client version, service account and logs. '
            + 'The upgrade was not scheduled; do not force-stop the daemon.',
            { cause: error },
          )
        }
        const readiness = ensureUpdaterInstalled()
        const input = {
          fromVersion: current,
          targetVersion: latest,
          oldDaemonPid: null,
          jobId: randomUUID(),
        }
        const job = createUpdaterJob(input)
        await prepareUpdaterCandidate(job, {
          fetchOwnedArtifact: fetchOwnedCliArtifact,
          sourceOrder: getCliUpdateSourceOrder(),
        })
        prepareRecoveryServiceEntry(job, readiness.workerPath)
        launchUpdater(input, { readiness })
      }
      console.log()
      console.log(chalk.green(`✓ Upgrade scheduled ${current} → ${latest}`))
      console.log(chalk.gray('  The independent updater will verify, roll back if needed, and restart Shennian.'))
    })
}

// ─── Relay-triggered upgrade (called from session manager) ───────────────────

export async function handleUpgradeStart(
  client: CliRelayClient,
  reqId: string,
  targetVersion?: string,
  opts: {
    currentVersion?: string
    confirmedMajor?: boolean
    prepareForUpgrade?: (jobId: string) => { activeRunCount: number }
    cancelUpgradePreparation?: () => void
    shutdownAfterHandoff?: () => void
    suppressResponse?: boolean
    canHandoff?: () => boolean
    waitForCompletion?: boolean
  } = {},
): Promise<Record<string, unknown>> {
  const sendEvent = (payload: Record<string, unknown>) => {
    client.sendEvent({ type: 'event', event: 'upgrade', payload })
  }

  const current = opts.currentVersion ?? getCurrentVersion()

  // Resolve target version
  let latest: string
  try {
    sendEvent({ state: 'checking', machineId: 'self' })
    latest = targetVersion ?? await fetchLatestVersion()
  } catch (err) {
    const error = `Version check failed: ${err instanceof Error ? err.message : String(err)}`
    if (!opts.suppressResponse) client.sendRes({ type: 'res', id: reqId, ok: false, error })
    return { ok: false, error }
  }

  const changeType = classifyBidirectionalVersionChange(current, latest)
  if (latest === current) {
    if (!opts.suppressResponse) client.sendRes({ type: 'res', id: reqId, ok: true, payload: { alreadyLatest: true, version: current } })
    return { ok: true, alreadyLatest: true, version: current }
  }
  if (!hasMajorUpgradeConfirmation(changeType, opts.confirmedMajor === true)) {
    if (!opts.suppressResponse) client.sendRes({
      type: 'res',
      id: reqId,
      ok: false,
      error: 'Major version changes require explicit second confirmation',
    })
    return { ok: false, error: 'Major version changes require explicit second confirmation' }
  }

  const jobId = randomUUID()
  let lock: ReturnType<typeof acquireUpgradeLock>
  try {
    lock = acquireUpgradeLock()
    try { assertUpdaterAvailable(resolveShennianPath('runtime', 'updater')) }
    catch (error) { lock.release(); throw error }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!opts.suppressResponse) client.sendRes({ type: 'res', id: reqId, ok: false, error: message })
    return { ok: false, error: message }
  }
  const payload = { from: current, to: latest, jobId }
  const complete = async () => {
    let frozen = false
    try {
      const readiness = ensureUpdaterInstalled()
      const input = {
        fromVersion: current,
        targetVersion: latest,
        oldDaemonPid: process.pid,
        jobId,
        requireHandoffAck: true,
      }
      const job = createUpdaterJob(input)
      sendEvent({ state: 'downloading', machineId: 'self', version: latest, jobId })
      await prepareUpdaterCandidate(job, {
        fetchOwnedArtifact: fetchOwnedCliArtifact,
        sourceOrder: getCliUpdateSourceOrder(),
      })
      prepareRecoveryServiceEntry(job, readiness.workerPath)
      launchUpdater(input, { readiness })
      await waitForUpdaterReady(job)
      // A live, ready worker must still not terminate the daemon until the
      // synchronous idle/freeze/fsync boundary explicitly acknowledges handoff.
      if (opts.canHandoff && !opts.canHandoff()) throw new Error('upgrade_waiting_for_idle')
      const prepared = opts.prepareForUpgrade?.(jobId) ?? { activeRunCount: 0 }
      frozen = true
      confirmUpdaterHandoff(job)
      sendEvent({ state: 'restarting', machineId: 'self', ...payload, activeRunCount: prepared.activeRunCount })
      // The acknowledged worker owns stopping the daemon; the daemon never
      // voluntarily exits into a missing/dead helper's hands.
      return { ok: true, ...payload, resultPath: job.resultPath }
    } catch (error) {
      if (frozen) opts.cancelUpgradePreparation?.()
      const message = error instanceof Error ? error.message : String(error)
      if (message !== 'upgrade_waiting_for_idle') recordUpgradeFailure(latest, message)
      sendEvent({ state: 'failed', machineId: 'self', error: message, jobId })
      return { ok: false, error: message }
    } finally {
      lock.release()
    }
  }
  // Acknowledge acceptance before a potentially slow npm download. Closing the
  // App or timing out its request must not cancel preparation or freeze dispatch.
  if (!opts.suppressResponse) client.sendRes({ type: 'res', id: reqId, ok: true, payload })
  if (opts.waitForCompletion) return complete()
  void complete()
  return { ok: true, ...payload }

}

export async function handleUpgradeStatus(
  client: CliRelayClient,
  reqId: string,
  opts: { currentVersion?: string } = {},
): Promise<void> {
  const result = await checkForUpdate(opts.currentVersion)
  client.sendRes({
    type: 'res',
    id: reqId,
    ok: true,
    payload: result.hasUpdate
      ? { hasUpdate: true, current: result.current, latest: result.latest, changeType: result.changeType }
      : { hasUpdate: false, current: opts.currentVersion ?? getCurrentVersion() },
  })
}
