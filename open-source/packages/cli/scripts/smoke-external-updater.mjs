#!/usr/bin/env node

// Release-only black-box smoke. Every runtime module is loaded from the npm
// prefix under test, never from the workspace build.

import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const [prefix, expectedVersion] = process.argv.slice(2)
if (!prefix || !expectedVersion) throw new Error('usage: smoke-external-updater.mjs <prefix> <version>')
const packageRoot = process.platform === 'win32'
  ? path.join(prefix, 'node_modules', 'shennian')
  : path.join(prefix, 'lib', 'node_modules', 'shennian')
const requireFromPackage = createRequire(path.join(packageRoot, 'package.json'))
const { WebSocketServer } = requireFromPackage('ws')
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-updater-e2e-'))
process.env.SHENNIAN_HOME = home
// Explicitly authorize this isolated temp-home daemon to coexist with the
// developer/test host's real daemon. This is a release-only safety contract.
process.env.SHENNIAN_E2E_ISOLATED_DAEMON = '1'
// Keep provider CLIs from the developer/test host out of this daemon's startup
// discovery. Apart from making the release smoke deterministic, this prevents
// an unrelated slow or wedged ACP executable from hiding an updater failure.
// npm lives beside the Node executable on every supported packaged test host;
// retain the OS utility directories on Unix for npm's own subprocesses.
const npmExecutable = path.join(
  path.dirname(process.execPath),
  process.platform === 'win32' ? 'npm.cmd' : 'npm',
)
process.env.PATH = process.platform === 'win32'
  ? path.dirname(process.execPath)
  : [path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter)
let identityRequests = 0

const server = http.createServer((request, response) => {
  if (request.url === '/api/machines/identity') {
    identityRequests += 1
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({
      machineId: 'release-updater-e2e',
      daemonInstallationId: 'release-updater-installation',
      dataEpoch: 2,
    }))
    return
  }
  if (request.url === '/log') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end('{"ok":true}')
    return
  }
  response.writeHead(404)
  response.end()
})
const websocket = new WebSocketServer({ noServer: true })
server.on('upgrade', (request, socket, head) => {
  websocket.handleUpgrade(request, socket, head, (client) => websocket.emit('connection', client, request))
})
websocket.on('connection', (client) => {
  client.on('message', (raw) => {
    let frame
    try { frame = JSON.parse(raw.toString()) } catch { return }
    if (frame?.type !== 'req') return
    const payload = frame.method === 'session.deletions.sync'
      ? {
          protocolVersion: frame.params?.protocolVersion ?? 1,
          dataEpoch: frame.params?.dataEpoch ?? 2,
          daemonInstallationId: 'release-updater-installation',
          baselineRevision: 0,
          latestRevision: 0,
          deletions: [],
        }
      : {}
    client.send(JSON.stringify({ type: 'res', id: frame.id, ok: true, payload }))
  })
})

let daemonPid = null
try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({
    machineId: 'release-updater-e2e',
    machineToken: 'fixture-token',
    serverUrl: `http://127.0.0.1:${port}`,
  }), { mode: 0o600 })
  fs.writeFileSync(path.join(home, 'installation.json'), JSON.stringify({
    schemaVersion: 1,
    daemonInstallationId: 'release-updater-installation',
    createdAt: new Date().toISOString(),
  }), { mode: 0o600 })

  const launcherUrl = pathToFileURL(path.join(packageRoot, 'dist', 'src', 'upgrade', 'updater-launcher.js')).href
  const { launchUpdater } = await import(launcherUrl)
  const { job } = launchUpdater({
    fromVersion: expectedVersion,
    targetVersion: expectedVersion,
    oldDaemonPid: null,
    npmPrefix: prefix,
    npmExecutable,
    nodeExecutable: process.execPath,
    jobId: `release-e2e-${Date.now()}`,
    isolatedDaemonStart: true,
  })
  const deadline = Date.now() + 180_000
  let result = null
  while (Date.now() < deadline) {
    try { result = JSON.parse(fs.readFileSync(job.resultPath, 'utf8')) } catch {}
    if (result?.state === 'healthy' || result?.state === 'rolled_back' || result?.state === 'failed') break
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  if (result?.state !== 'healthy') throw new Error(`external updater did not become healthy: ${result?.state ?? 'timeout'}:${result?.errorCode ?? ''}:identityRequests=${identityRequests}`)
  const pidRecord = JSON.parse(fs.readFileSync(path.join(home, 'daemon.pid'), 'utf8'))
  daemonPid = Number(pidRecord.pid)
  if (!Number.isSafeInteger(daemonPid) || pidRecord.version !== expectedVersion) {
    throw new Error('replacement daemon identity mismatch')
  }
  const current = JSON.parse(fs.readFileSync(path.join(home, 'runtime', 'updater', 'current.json'), 'utf8'))
  if (current.protocolVersion !== 1 || !fs.existsSync(current.workerPath)) {
    throw new Error('updater readiness marker is invalid')
  }
  console.log(`external updater smoke healthy (${process.platform}, ${expectedVersion})`)
} finally {
  if (daemonPid) {
    try { process.kill(daemonPid, 'SIGTERM') } catch {}
    const deadline = Date.now() + 5_000
    while (Date.now() < deadline) {
      try { process.kill(daemonPid, 0) } catch { break }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    try { process.kill(daemonPid, 'SIGKILL') } catch {}
    await new Promise((resolve) => setTimeout(resolve, process.platform === 'win32' ? 1_000 : 100))
  }
  for (const client of websocket.clients) client.terminate()
  await new Promise((resolve) => {
    server.close(resolve)
    server.closeAllConnections?.()
  })
  try {
    fs.rmSync(home, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
  } catch {
    // Cleanup must not mask the upgrade assertion on hosts where antivirus or
    // process teardown briefly retains a handle. The OS temp cleaner owns the
    // already-isolated, credential-free fixture directory.
    console.warn('external updater smoke cleanup deferred')
  }
}
