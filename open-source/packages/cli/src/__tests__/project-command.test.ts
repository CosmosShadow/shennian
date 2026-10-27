// @covers src/commands/project.ts
// @covers src/agents/project-client.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Command } from 'commander'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const config = vi.hoisted(() => ({ value: { machineToken: 'machine-secret', serverUrl: 'https://server.test' } as Record<string, unknown> }))
vi.mock('../config/index.js', () => ({ loadConfig: () => config.value }))

import { ProjectClient } from '../agents/project-client.js'
import { registerProjectCommand } from '../commands/project.js'

function harness(fetchImpl: typeof fetch) {
  let output = ''
  let failures = 0
  const program = new Command().exitOverride()
  program.configureOutput({ writeOut: () => {}, writeErr: () => {} })
  registerProjectCommand(program, {
    client: new ProjectClient(fetchImpl),
    io: { write: (text) => { output += text }, fail: () => { failures += 1 } },
  })
  const run = async (...args: string[]) => {
    output = ''
    failures = 0
    await program.parseAsync(['node', 'shennian', ...args])
    return { json: output ? JSON.parse(output) : null, failures }
  }
  return { run }
}

const respond = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch

beforeEach(() => { config.value = { machineToken: 'machine-secret', serverUrl: 'https://server.test' } })

describe('project CLI commands', () => {
  it('lists projects with the machine token and prints one JSON line', async () => {
    const fetchImpl = respond(200, { projects: [{ projectId: 'p1' }] })
    const { run } = harness(fetchImpl)
    const { json, failures } = await run('project', 'list')
    expect(json).toEqual({ ok: true, command: 'project.list', result: { projects: [{ projectId: 'p1' }] } })
    expect(failures).toBe(0)
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0]!
    expect(url).toBe('https://server.test/api/project-cli/projects')
    expect((init as RequestInit).headers).toMatchObject({ authorization: 'Bearer machine-secret' })
    expect((init as RequestInit).redirect).toBe('error')
  })

  it('creates a task with a generated request id, or the one given for a safe retry', async () => {
    const fetchImpl = respond(200, { status: 'created', taskId: 't1' })
    const { run } = harness(fetchImpl)
    await run('project', 'task', 'create', 'p1', '--instruction', '  修复登录  ')
    let body = JSON.parse(String((vi.mocked(fetchImpl).mock.calls[0]![1] as RequestInit).body))
    expect(body.instruction).toBe('修复登录')
    expect(body.requestId).toMatch(/^steward-[0-9a-f-]{36}$/)
    await run('project', 'task', 'create', 'p1', '--instruction', 'go', '--request-id', 'retry-0001-abcd', '--agent', 'codex')
    body = JSON.parse(String((vi.mocked(fetchImpl).mock.calls[1]![1] as RequestInit).body))
    expect(body).toEqual({ instruction: 'go', requestId: 'retry-0001-abcd', agentType: 'codex' })
  })

  it('reads the instruction from a file and rejects invalid input before any request', async () => {
    const fetchImpl = respond(200, { status: 'created' })
    const { run } = harness(fetchImpl)
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-project-cmd-')), 'task.txt')
    fs.writeFileSync(file, '来自文件的任务\n')
    try {
      await run('project', 'task', 'create', 'p1', '--instruction-file', file)
      expect(JSON.parse(String((vi.mocked(fetchImpl).mock.calls[0]![1] as RequestInit).body)).instruction).toBe('来自文件的任务')
      for (const args of [
        ['project', 'task', 'create', 'p1'],
        ['project', 'task', 'create', 'p1', '--instruction', 'a', '--instruction-file', file],
        ['project', 'task', 'create', 'bad id', '--instruction', 'a'],
        ['project', 'task', 'create', 'p1', '--instruction', 'a', '--request-id', 'x'],
        ['project', 'task', 'send', 't1', '--text', ''],
      ]) {
        const { json, failures } = await run(...args)
        expect(json.ok).toBe(false)
        expect(failures).toBe(1)
      }
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    } finally {
      fs.rmSync(path.dirname(file), { recursive: true, force: true })
    }
  })

  it('reads, sends and stops by exact task id', async () => {
    const fetchImpl = respond(200, { ok: 1 })
    const { run } = harness(fetchImpl)
    await run('project', 'task', 'read', 't1', '--limit', '99')
    await run('project', 'task', 'send', 't1', '--text', '继续', '--request-id', 'send-0001-abcd')
    await run('project', 'task', 'stop', 't1')
    await run('project', 'task', 'list', 'p1', '--limit', '0')
    const calls = vi.mocked(fetchImpl).mock.calls.map(([url, init]) => [String(url), (init as RequestInit).method])
    expect(calls).toEqual([
      ['https://server.test/api/project-cli/tasks/t1/messages?limit=8', 'GET'],
      ['https://server.test/api/project-cli/tasks/t1/messages', 'POST'],
      ['https://server.test/api/project-cli/tasks/t1/stop', 'POST'],
      ['https://server.test/api/project-cli/projects/p1/tasks?limit=1', 'GET'],
    ])
  })

  it('reports server errors and an unpaired Client with stable codes and no token', async () => {
    const { run } = harness(respond(503, { error: 'machine_unavailable', message: 'Mac 当前离线' }))
    const offline = await run('project', 'task', 'stop', 't1')
    expect(offline.json).toEqual({ ok: false, error: 'machine_unavailable', message: 'Mac 当前离线', nextAction: null })
    expect(offline.failures).toBe(1)

    config.value = {}
    const fetchImpl = respond(200, {})
    const unpaired = await harness(fetchImpl).run('project', 'list')
    expect(unpaired.json).toMatchObject({ ok: false, error: 'not_paired', nextAction: { command: 'shennian pair --browser' } })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(JSON.stringify(unpaired.json)).not.toContain('machine-secret')
  })

  it('reports an unreachable service', async () => {
    const { run } = harness(vi.fn(async () => { throw new Error('boom') }) as unknown as typeof fetch)
    expect((await run('project', 'list')).json).toMatchObject({ ok: false, error: 'server_unavailable' })
  })
})

it('creates and updates project metadata through the machine-authenticated control surface', async () => {
  const fetcher = respond(200, { project: { id: 'p' } }), { run } = harness(fetcher)
  await run('project', 'create', '--machine', 'm', '--workdir', '/project', '--name', 'Example')
  expect(vi.mocked(fetcher).mock.calls[0]?.[0]).toBe('https://server.test/api/project-cli/projects')
  expect(JSON.parse(String((vi.mocked(fetcher).mock.calls[0]?.[1] as RequestInit).body))).toEqual({ machineId: 'm', workDir: '/project', name: 'Example' })
  await run('project', 'update', 'p', '--name', 'Updated', '--agent', 'codex')
  expect(vi.mocked(fetcher).mock.calls[1]?.[1]).toMatchObject({ method: 'PATCH', body: JSON.stringify({ name: 'Updated', agentType: 'codex', modelId: null }) })
})
it('attaches project task completion tracking only inside the personal steward context', async () => {
  vi.stubEnv('SHENNIAN_STEWARD_SESSION_ID', 'steward')
  try {
    const fetcher = respond(200, { status: 'created', taskId: 'task' }), { run } = harness(fetcher)
    await run('project', 'task', 'create', 'p', '--instruction', 'A task')
    expect(vi.mocked(fetcher).mock.calls[1]?.[0]).toBe('https://server.test/api/project-cli/tasks/task/watch')
    expect(JSON.parse(String((vi.mocked(fetcher).mock.calls[1]?.[1] as RequestInit).body))).toEqual({ stewardSessionId: 'steward' })
  } finally { vi.unstubAllEnvs() }
})
