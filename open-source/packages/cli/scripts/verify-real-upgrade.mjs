#!/usr/bin/env node
// @arch open-source/docs/cli-runtime.md
// @test scripts/__tests__/verify-real-upgrade-policy.test.mjs
// Real existing installation + identity + production Relay health. No fixture server/home.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'

export function assertIndependentClientStatus(status) {
  if (!status?.running) throw new Error('existing daemon must be running before verification')
  if (status.client?.source === 'desktop-managed' || status.client?.updateOwner === 'desktop') {
    throw new Error(
      'legacy Desktop-managed Client detected; migrate to the independently installed Client before upgrade verification',
    )
  }
  return status
}

/** The official installer owns a private prefix, independent of the system npm (including nvm). */
export function resolveInstalledPackageRoot(status, npmRoot, exists = fs.existsSync) {
  if (status?.shennianDir) {
    const installed = path.join(status.shennianDir, 'cli', 'node_modules', 'shennian')
    if (exists(path.join(installed, 'dist', 'src', 'daemon-ipc', 'client.js'))) return installed
  }
  return path.join(npmRoot(), 'shennian')
}

async function main() {
  const target = process.argv[2]
  if (!/^\d+\.\d+\.\d+$/.test(target ?? '')) throw new Error('exact numeric target required')
  if (process.env.SHENNIAN_E2E_ISOLATED_DAEMON === '1' || process.env.SHENNIAN_HOME) throw new Error('real default installation required')
  const home = path.join(os.homedir(), '.shennian')
  const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
  const fingerprint = () => {
    const config = read(path.join(home, 'config.json'))
    const installation = read(path.join(home, 'installation.json'))
    return createHash('sha256').update(JSON.stringify([
      config.machineId, config.machineToken, config.accountNamespaceId, installation.daemonInstallationId,
    ])).digest('hex')
  }
  const shennian = 'shennian'
  const cliOptions = { encoding: 'utf8', windowsHide: true, shell: process.platform === 'win32', timeout: 30_000 }
  const callCli = (args) => JSON.parse(execFileSync(shennian, args, cliOptions))
  const before = fingerprint()
  let initialCliStatus
  try { initialCliStatus = callCli(['status', '--json']) } catch { /* The npm bin can be absent from a non-interactive PATH. */ }
  const started = Date.now()

  if (initialCliStatus) assertIndependentClientStatus(initialCliStatus)

  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const npmOptions = { encoding: 'utf8', windowsHide: true, shell: process.platform === 'win32', timeout: 30_000 }
  const packageRoot = resolveInstalledPackageRoot(initialCliStatus, () => execFileSync(npm, ['root', '-g'], npmOptions).trim())
  const source = path.join(packageRoot, 'dist/src')
  const { callDaemonIpc } = await import(pathToFileURL(path.join(source, 'daemon-ipc/client.js')).href)
  const initial = await callDaemonIpc({ method: 'daemon.status', timeoutMs: 10_000 })
  assertIndependentClientStatus(initial)
  const baseline = read(path.join(packageRoot, 'package.json')).version
  if (baseline !== target) {
    const response = await callDaemonIpc({ method: 'upgrade.start', params: { targetVersion: target }, timeoutMs: 15_000 })
    if (!response.ok) throw new Error(`upgrade rejected: ${response.error ?? 'unknown'}`)
    const jobId = response.jobId
    if (!jobId) throw new Error('upgrade did not return a durable job identity')
    const resultPath = path.join(home, 'runtime/updater/results', `${jobId}.json`)
    let healthy = false
    while (Date.now() - started < 12 * 60_000) {
      let result
      try { result = read(resultPath) } catch { /* preparation still running */ }
      const failureFile = path.join(home, 'upgrade-failures.json')
      let preparationFailure
      try { preparationFailure = read(failureFile).versions?.[target] } catch { /* no previous failure */ }
      if (preparationFailure?.lastFailedAt >= started) throw new Error('candidate_preparation_failed_old_service_retained')
      if (result?.state === 'healthy') { healthy = true; break }
      if (['failed', 'rolled_back'].includes(result?.state)) throw new Error(`upgrade ${result.state}:${result.errorCode ?? ''}`)
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    if (!healthy) throw new Error('real upgrade health timeout')
  }
  const status = await callDaemonIpc({ method: 'daemon.status', timeoutMs: 10_000 })
  const agents = await callDaemonIpc({ method: 'agent.list', timeoutMs: 10_000 })
  if (!status.running || read(path.join(packageRoot, 'package.json')).version !== target || before !== fingerprint()) {
    throw new Error('version, daemon or retained identity verification failed')
  }
  console.log(JSON.stringify({ platform: process.platform, baseline, target, identityRetained: true,
    running: true, agentCount: agents.agents.length, elapsedMs: Date.now() - started,
    result: baseline === target ? 'already-installed-status-only' : 'real-upgrade-healthy',
    // Agent replies/UI remain a separate real observation, never fabricated here.
    businessReplyVerified: false,
  }))
}

if (process.argv[1]
  && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) await main()
