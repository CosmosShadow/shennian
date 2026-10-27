// @covers src/commands/command-reference.ts
import { Command } from 'commander'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerCommandReference } from '../commands/command-reference.js'

const originalExitCode = process.exitCode

afterEach(() => {
  process.exitCode = originalExitCode
  vi.restoreAllMocks()
})

function createProgram() {
  const program = new Command().name('shennian').exitOverride()
  const action = vi.fn()
  const adapter = program.command('adapter').description('Manage adapters')
  adapter.command('internal-adapter', { hidden: true }).description('Managed-only adapter command')
  adapter.command('init <directory>').description('Create adapter template')
    .requiredOption('--name <name>', 'Adapter display name')
    .action(action)
  program.command('internal', { hidden: true }).description('Internal command')
  registerCommandReference(program, '0.5.7')
  const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  const error = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  return { program, action, output, error }
}

describe('installed Client command reference', () => {
  it('shows the installed command and exact options without executing it', async () => {
    const { program, action, output } = createProgram()
    await program.parseAsync(['help', 'adapter', 'init'], { from: 'user' })
    const response = String(output.mock.calls[0]?.[0])
    expect(response).toContain('Shennian Client 0.5.7')
    expect(response).toContain('adapter init')
    expect(response).toContain('--name <name>')
    expect(action).not.toHaveBeenCalled()
  })

  it('omits hidden commands and rejects unknown paths', async () => {
    const { program, output, error } = createProgram()
    await program.parseAsync(['help'], { from: 'user' })
    const root = String(output.mock.calls[0]?.[0])
    expect(root).toContain('adapter')
    expect(root).not.toContain('internal')

    output.mockClear()
    await program.parseAsync(['help', 'adapter'], { from: 'user' })
    expect(String(output.mock.calls[0]?.[0])).not.toContain('internal-adapter')

    output.mockClear()
    await program.parseAsync(['help', 'internal'], { from: 'user' })
    expect(String(error.mock.calls[0]?.[0])).toContain('Unknown command: internal')
    expect(process.exitCode).toBe(1)

    error.mockClear()
    await program.parseAsync(['help', 'adapter', 'internal-adapter'], { from: 'user' })
    expect(String(error.mock.calls[0]?.[0])).toContain('Unknown command: adapter internal-adapter')
  })
})
