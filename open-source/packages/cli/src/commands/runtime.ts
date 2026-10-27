// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/runtime-command.test.ts

import type { Command } from 'commander'
import { loadConfig, saveConfig, type CustomAgentEntry } from '../config/index.js'
import { spawnCommandString } from '../agents/command-spec.js'
import { assessCustomRuntimeSecurity } from '../agents/custom-managed-runtime.js'

type Caps = CustomAgentEntry['caps']

export function getCapsModels(caps: Caps): string[] {
  if (caps.models?.length) return caps.models
  if (caps.model) return [caps.model]
  return []
}

export async function probeCaps(
  command: string,
  options: { allowNoModels?: boolean } = {},
): Promise<Caps> {
  return new Promise<Caps>((resolve, reject) => {
    const proc = spawnCommandString(command, ['/caps'], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      callback()
    }

    proc.stdout?.on('data', (data: Buffer) => { stdout += data.toString() })
    proc.stderr?.on('data', (data: Buffer) => { stderr += data.toString() })
    proc.on('error', (error) => finish(() => reject(new Error(`Failed to run command: ${error.message}`))))
    proc.on('close', () => finish(() => {
      const line = stdout.trim().split('\n').find((value) => value.trim().startsWith('{'))
      if (!line) {
        reject(new Error(`Command did not output valid caps JSON.\nstdout: ${stdout.trim()}\nstderr: ${stderr.trim()}`))
        return
      }
      try {
        const caps = JSON.parse(line) as Caps
        if (!caps.name || !caps.mode) throw new Error('Caps JSON must contain "name" and "mode" fields')
        if (!options.allowNoModels && getCapsModels(caps).length === 0) {
          throw new Error('Caps JSON must contain either "model" or a non-empty "models" array')
        }
        if (caps.mode !== 'spawn' && caps.mode !== 'stdio') {
          throw new Error(`Caps "mode" must be "spawn" or "stdio", got: ${caps.mode}`)
        }
        resolve(caps)
      } catch (error) {
        reject(error instanceof Error ? error : new Error(`Failed to parse caps JSON: ${line}`))
      }
    }))

    const timer = setTimeout(() => {
      proc.kill('SIGTERM')
      finish(() => reject(new Error('Timed out waiting for caps response (5s)')))
    }, 5000)
  })
}

export function registerRuntimeCommand(program: Command): void {
  const runtime = program.command('runtime').description('Manage custom Agent runtimes')

  runtime
    .command('add <name>')
    .description('Register a custom Agent runtime')
    .requiredOption('--command <cmd>', 'Command to run the runtime')
    .action(async (name: string, opts: { command: string }) => {
      if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
        writeError('invalid_runtime_name', 'Runtime name may contain only letters, numbers, hyphens, and underscores.')
        return
      }
      let caps: Caps
      try {
        caps = await probeCaps(opts.command)
      } catch (error) {
        writeError('runtime_probe_failed', error instanceof Error ? error.message : String(error))
        return
      }
      const nextEntry = { command: opts.command, caps } satisfies CustomAgentEntry
      const security = assessCustomRuntimeSecurity(nextEntry)
      if (caps.security && security.state === 'unverified') {
        writeError(
          'runtime_security_declaration_invalid',
          `Custom runtime security declaration could not be verified: ${security.reason}`,
        )
        return
      }
      const config = loadConfig()
      config.customAgents = config.customAgents ?? {}
      config.customAgents[name] = nextEntry
      saveConfig(config)
      writeSuccess('runtime.add', {
        runtimeRef: `custom:${name}`,
        name: caps.name,
        models: getCapsModels(caps),
        mode: caps.mode,
        version: caps.version ?? null,
        managedProtection: 'unverified',
        securityDeclaration: security.state,
      })
    })

  runtime
    .command('list')
    .description('List registered custom Agent runtimes')
    .action(() => {
      const entries = Object.entries(loadConfig().customAgents ?? {}).map(([name, entry]) => ({
        runtimeRef: `custom:${name}`,
        name: entry.caps.name,
        models: getCapsModels(entry.caps),
        mode: entry.caps.mode,
        command: entry.command,
        version: entry.caps.version ?? null,
        managedProtection: 'unverified',
        securityDeclaration: assessCustomRuntimeSecurity(entry).state,
      }))
      writeSuccess('runtime.list', { runtimes: entries })
    })

  runtime
    .command('remove <name>')
    .description('Unregister a custom Agent runtime')
    .action((name: string) => {
      const config = loadConfig()
      if (!config.customAgents?.[name]) {
        writeError('runtime_not_found', `No custom runtime named "${name}" exists.`)
        return
      }
      delete config.customAgents[name]
      saveConfig(config)
      writeSuccess('runtime.remove', { runtimeRef: `custom:${name}` })
    })
}

function writeSuccess(command: string, result: unknown): void {
  process.stdout.write(`${JSON.stringify({ ok: true, command, result })}\n`)
}

function writeError(code: string, message: string): void {
  process.stdout.write(`${JSON.stringify({
    ok: false,
    error: code,
    message,
    nextAction: null,
  })}\n`)
  process.exitCode = 1
}
