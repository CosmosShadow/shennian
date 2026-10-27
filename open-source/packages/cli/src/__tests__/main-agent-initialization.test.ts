// @covers src/commands/steward.ts
// @covers src/commands/setup.ts
// @covers src/steward/workspace.ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Command } from 'commander'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { registerStewardCommand } from '../commands/steward.js'
import { runSetup, type SetupDeps, type SetupEvent } from '../commands/setup.js'
import { getStewardDir } from '../steward/workspace.js'

let root: string, previous: string | undefined
beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'main-agent-init-')))
  previous = process.env.SHENNIAN_HOME
  process.env.SHENNIAN_HOME = path.join(root, '.client')
})
afterEach(() => {
  vi.restoreAllMocks()
  if (previous === undefined) delete process.env.SHENNIAN_HOME
  else process.env.SHENNIAN_HOME = previous
  fs.rmSync(root, { recursive: true, force: true })
})

it.each(['start', 'run-service', 'daemon restart'])('prepares main Agent files before %s, without overwriting user files on rerun', async (command) => {
  const program = new Command()
  registerStewardCommand(program)
  const parts = command.split(' ')
  const parent = parts.length === 2 ? program.command(parts[0]!) : program
  let called = 0
  parent.command(parts.at(-1)!).action(() => {
    expect(fs.readdirSync(getStewardDir()).sort()).toEqual(['AGENTS.md', 'CLAUDE.md', 'index.md'])
    called++
  })
  await program.parseAsync(['node', 'shennian', ...parts])
  fs.writeFileSync(path.join(getStewardDir(), 'index.md'), '# My index')
  fs.unlinkSync(path.join(getStewardDir(), 'CLAUDE.md'))
  await program.parseAsync(['node', 'shennian', ...parts])
  expect(called).toBe(2)
  expect(fs.readFileSync(path.join(getStewardDir(), 'index.md'), 'utf8')).toBe('# My index')
})

it('does not initialize a main Agent workspace for worker start or read-only status', async () => {
  const program = new Command()
  registerStewardCommand(program)
  program.command('worker').command('start').action(() => {})
  program.command('status').action(() => {})
  await program.parseAsync(['node', 'shennian', 'worker', 'start'])
  await program.parseAsync(['node', 'shennian', 'status'])
  expect(fs.existsSync(getStewardDir())).toBe(false)
})

it('reports setup failure before pairing or service start when workspace preparation fails', async () => {
  fs.writeFileSync(getStewardDir(), 'a file cannot be the workspace')
  const createIntent = vi.fn(), ensureDaemon = vi.fn(), installSkills = vi.fn()
  const events: SetupEvent[] = []
  const done = await runSetup({ interactive: false, emit: e => events.push(e), deps: {
    clientVersion: () => 'test', createIntent, ensureDaemon, installSkills,
  } as Partial<SetupDeps> })
  expect(done.status).toBe('failed')
  expect(events).toContainEqual(expect.objectContaining({ step: 'workspace', status: 'failed' }))
  expect(createIntent).not.toHaveBeenCalled()
  expect(ensureDaemon).not.toHaveBeenCalled()
  expect(installSkills).not.toHaveBeenCalled()
})
