// @covers src/index.ts

import { execFile, execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const testDirectory = path.dirname(fileURLToPath(import.meta.url))
const cliDirectory = path.resolve(testDirectory, '../..')
const execFileAsync = promisify(execFile)
const tsxImport = import.meta.resolve('tsx')
// Source CLI startup loads its module graph, but must never read a real HOME.
// A cold, CPU-limited CI runner has a separate bounded startup budget.
const CLI_STARTUP_MS = 15_000
let testHome: string
beforeEach(() => {
  const parent = path.join(os.tmpdir(), 'shennian-tests', 'unit')
  fs.mkdirSync(parent, { recursive: true })
  testHome = fs.mkdtempSync(path.join(parent, 'public-cli-'))
  vi.stubEnv('SHENNIAN_HOME', testHome)
})
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(testHome, { recursive: true, force: true }) })

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
}

function writeJson(response: ServerResponse, status: number, body: Record<string, unknown>): void {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}

describe('public CLI command surface', () => {
  it('offers Room collaboration, local ACP registration, and opaque-ref Worker delegation', () => {
    const output = execFileSync(
      process.execPath,
      ['--import', 'tsx', path.join(cliDirectory, 'src/index.ts'), '--help'],
      { cwd: cliDirectory, encoding: 'utf8', timeout: CLI_STARTUP_MS },
    )

    expect(output).toMatch(/^Usage: shennian/m)
    expect(output).toMatch(/^\s+room\s/m)
    expect(output).toMatch(/^\s+agent\s/m)
    expect(output).toMatch(/^\s+worker\s/m)

    const workerOutput = execFileSync(
      process.execPath,
      ['--import', 'tsx', path.join(cliDirectory, 'src/index.ts'), 'worker', '--help'],
      { cwd: cliDirectory, encoding: 'utf8', timeout: CLI_STARTUP_MS },
    )
    expect(workerOutput).toMatch(/^\s+start\s/m)
    expect(workerOutput).toMatch(/^\s+read\s/m)
    expect(workerOutput).toMatch(/^\s+send\s/m)
    expect(workerOutput).toMatch(/^\s+wait\s/m)
    expect(workerOutput).toMatch(/^\s+stop\s/m)
    expect(workerOutput).toMatch(/^\s+list\s/m)
    expect(workerOutput).toMatch(/^\s+report\s/m)
    expect(workerOutput).not.toMatch(/^\s+(search|recent)\s/m)
  }, 40_000)

  it('offers project and task control, with a stable JSON error when not paired', () => {
    const shennianHome = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-project-cli-'))
    try {
      const help = execFileSync(
        process.execPath,
        ['--import', 'tsx', path.join(cliDirectory, 'src/index.ts'), 'help', 'project', 'task'],
        { cwd: cliDirectory, encoding: 'utf8', timeout: CLI_STARTUP_MS, env: { ...process.env, SHENNIAN_HOME: shennianHome } },
      )
      for (const name of ['list', 'create', 'watch', 'read', 'send', 'stop']) {
        expect(help).toMatch(new RegExp(`^\\s+${name}\\s`, 'm'))
      }
      const result = spawnSync(
        process.execPath,
        ['--import', 'tsx', path.join(cliDirectory, 'src/index.ts'), 'project', 'list'],
        { cwd: cliDirectory, encoding: 'utf8', timeout: CLI_STARTUP_MS, env: { ...process.env, SHENNIAN_HOME: shennianHome } },
      )
      expect(result.status).toBe(1)
      expect(JSON.parse(result.stdout)).toMatchObject({
        ok: false, error: 'not_paired', nextAction: { command: 'shennian pair --browser' },
      })
    } finally {
      fs.rmSync(shennianHome, { recursive: true, force: true })
    }
  }, 40_000)

  it('offers steward say, with a stable JSON error when no daemon is running', () => {
    const shennianHome = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-steward-cli-'))
    try {
      const env = { ...process.env, SHENNIAN_HOME: shennianHome }
      delete (env as Record<string, string | undefined>).SHENNIAN_STEWARD_SESSION_ID
      const help = execFileSync(
        process.execPath,
        ['--import', 'tsx', path.join(cliDirectory, 'src/index.ts'), 'help', 'steward'],
        { cwd: cliDirectory, encoding: 'utf8', timeout: CLI_STARTUP_MS, env },
      )
      expect(help).toMatch(/^\s+say\s/m)
      const result = spawnSync(
        process.execPath,
        ['--import', 'tsx', path.join(cliDirectory, 'src/index.ts'), 'steward', 'say', 'hello'],
        { cwd: cliDirectory, encoding: 'utf8', timeout: CLI_STARTUP_MS, env },
      )
      expect(result.status).toBe(1)
      expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, error: 'daemon_unavailable' })
    } finally {
      fs.rmSync(shennianHome, { recursive: true, force: true })
    }
  }, 40_000)

  it('exposes Agent management with stable JSON errors when the CLI is not paired', () => {
    const shennianHome = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-agent-cli-'))
    try {
      const result = spawnSync(
        process.execPath,
        ['--import', 'tsx', path.join(cliDirectory, 'src/index.ts'), 'agent', 'get', 'agent_123'],
        {
          cwd: cliDirectory,
          encoding: 'utf8',
          env: { ...process.env, SHENNIAN_HOME: shennianHome },
        },
      )

      expect(result.status).toBe(1)
      expect(result.stderr).toBe('')
      expect(result.stdout.trim().split('\n')).toHaveLength(1)
      expect(JSON.parse(result.stdout)).toMatchObject({
        ok: false,
        error: 'not_paired',
        message: expect.any(String),
        nextAction: { type: 'run_command', command: 'shennian pair --browser' },
      })
    } finally {
      fs.rmSync(shennianHome, { recursive: true, force: true })
    }
  })

  it('returns stable single-line JSON and a failing exit code when the Worker daemon is unavailable', () => {
    const shennianHome = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-worker-cli-'))
    try {
      const result = spawnSync(
        process.execPath,
        [
          '--import', 'tsx', path.join(cliDirectory, 'src/index.ts'),
          'worker', 'read', '--ref', `wr_${'x'.repeat(43)}`, '--json',
        ],
        { cwd: cliDirectory, encoding: 'utf8', env: { ...process.env, SHENNIAN_HOME: shennianHome } },
      )
      expect(result.status).toBe(1)
      expect(result.stderr).toBe('')
      expect(result.stdout.trim().split('\n')).toHaveLength(1)
      expect(JSON.parse(result.stdout)).toMatchObject({
        ok: false,
        error: 'daemon_unavailable',
        nextAction: expect.any(String),
      })
    } finally {
      fs.rmSync(shennianHome, { recursive: true, force: true })
    }
  })

  it('executes every Worker command as stable JSON with cwd, explicit workdir, timeout, and exit-code contracts', async () => {
    const shennianHome = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-worker-cli-process-'))
    const defaultWorkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-worker-cwd-'))
    const explicitWorkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-worker-explicit-'))
    const resolvedDefaultWorkDir = fs.realpathSync(defaultWorkDir)
    const resolvedExplicitWorkDir = fs.realpathSync(explicitWorkDir)
    const requests: Array<{ operation: string; body: Record<string, unknown> }> = []
    const server = createServer(async (request, response) => {
      const operation = String(request.url || '').split('/').pop() || ''
      const body = await readJsonBody(request)
      requests.push({ operation, body })
      if (operation === 'wait') {
        writeJson(response, 408, {
          ok: false,
          error: 'wait_timed_out',
          message: 'Worker is still running.',
          nextAction: 'Call worker wait again with the same workerRef.',
        })
        return
      }
      writeJson(response, 200, {
        ok: true,
        operation,
        workerRef: `wr_${'a'.repeat(43)}`,
        resolvedWorkDir: typeof body.workDir === 'string' ? fs.realpathSync(body.workDir) : undefined,
      })
    })

    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', resolve)
      })
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('test server did not bind a TCP port')
      const runtimeDir = path.join(shennianHome, 'runtime')
      fs.mkdirSync(runtimeDir, { recursive: true, mode: 0o700 })
      const runtimePath = path.join(runtimeDir, 'manager-ipc.json')
      fs.writeFileSync(runtimePath, JSON.stringify({
        url: `http://127.0.0.1:${address.port}`,
        token: 'test-worker-token',
      }), { mode: 0o600 })

      const run = async (args: string[], cwd = defaultWorkDir) => {
        const result = await execFileAsync(process.execPath, [
          '--import', tsxImport, path.join(cliDirectory, 'src/index.ts'), ...args,
        ], {
          cwd,
          encoding: 'utf8',
          env: { ...process.env, SHENNIAN_HOME: shennianHome },
        })
        expect(result.stderr).toBe('')
        expect(result.stdout.trim().split('\n')).toHaveLength(1)
        return JSON.parse(result.stdout) as Record<string, unknown>
      }

      await expect(run(['worker', 'start', '--agent', 'claude', '--message', 'default cwd', '--json']))
        .resolves.toMatchObject({ ok: true, operation: 'start', resolvedWorkDir: resolvedDefaultWorkDir })
      await expect(run([
        'worker', 'start', '--agent', 'codex', '--workdir', explicitWorkDir,
        '--message', 'explicit cwd', '--json',
      ])).resolves.toMatchObject({ ok: true, operation: 'start', resolvedWorkDir: resolvedExplicitWorkDir })

      const workerRef = `wr_${'b'.repeat(43)}`
      await expect(run(['worker', 'read', '--ref', workerRef, '--limit', '12', '--json']))
        .resolves.toMatchObject({ ok: true, operation: 'read' })
      await expect(run(['worker', 'send', '--ref', workerRef, '--message', 'continue', '--json']))
        .resolves.toMatchObject({ ok: true, operation: 'send' })
      await expect(run(['worker', 'stop', '--ref', workerRef, '--json']))
        .resolves.toMatchObject({ ok: true, operation: 'stop' })

      await expect(run(['worker', 'wait', '--ref', workerRef, '--timeout', '1', '--json']))
        .rejects.toMatchObject({
          code: 1,
          stderr: '',
          stdout: expect.stringMatching(/^\{"ok":false,"error":"wait_timed_out"/),
        })

      expect(requests).toEqual([
        expect.objectContaining({ operation: 'start', body: expect.objectContaining({ workDir: resolvedDefaultWorkDir }) }),
        expect.objectContaining({ operation: 'start', body: expect.objectContaining({ workDir: explicitWorkDir }) }),
        { operation: 'read', body: { workerRef, limit: 12 } },
        { operation: 'send', body: { workerRef, message: 'continue' } },
        { operation: 'stop', body: { workerRef } },
        { operation: 'wait', body: { workerRef, timeoutMs: 1_000 } },
      ])
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      fs.rmSync(shennianHome, { recursive: true, force: true })
      fs.rmSync(defaultWorkDir, { recursive: true, force: true })
      fs.rmSync(explicitWorkDir, { recursive: true, force: true })
    }
  }, 30_000)
})
