// @arch open-source/docs/cli-runtime.md
// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/acp-manifests.test.ts

import type { Command } from 'commander'
import { registerAgentReadinessCommands } from './agent-readiness.js'
import {
  registerAgentWorkspaceCommands,
  type AgentCommandOptions,
} from './agent-workspace.js'
import { createAgent } from '../agents/adapter.js'
import { AcpAgentAdapter } from '../agents/acp/adapter.js'
import { discoverAcpAgents } from '../agents/acp/discovery.js'
import { callDaemonIpc } from '../daemon-ipc/client.js'
import {
  readAcpManifests,
  removeAcpManifest,
  validateAcpId,
  writeAcpManifest,
} from '../agents/acp/manifests.js'

export function registerAgentCommand(program: Command, options: AgentCommandOptions = {}): void {
  const agent = program.command('agent').description('Discover local AI tools and manage Shennian Agents')
  registerAgentReadinessCommands(agent)
  registerAgentWorkspaceCommands(agent, options)
  const integration = agent.command('integration').description('Manage locally registered ACP integrations')
  registerIntegrationCommands(integration)

  // Preserve the pre-workspace ACP command spellings without advertising them
  // as Shennian Agent identity management.
  registerIntegrationAdd(agent.command('add <id>', { hidden: true }))
  registerIntegrationRemove(agent.command('remove <id>', { hidden: true }))
  registerIntegrationAuth(agent.command('auth <id>', { hidden: true }))
}

function registerIntegrationCommands(integration: Command): void {
  registerIntegrationAdd(integration.command('add <id>'))
  integration.command('list')
    .description('List locally registered ACP Agents')
    .action(() => {
      writeResult(true, 'agent.integration.list', {
        agents: readAcpManifests().map((manifest) => ({
          agentRef: `acp:${manifest.id}`,
          name: manifest.name,
          command: manifest.launch.command,
          args: manifest.launch.args ?? [],
        })),
      })
    })
  registerIntegrationRemove(integration.command('remove <id>'))
  registerIntegrationAuth(integration.command('auth <id>'))
}

function registerIntegrationAdd(command: Command): void {
  command.description('Register an installed ACP v1 Agent (does not install it)')
    .requiredOption('--name <name>', 'Display name')
    .requiredOption('--command <command>', 'Absolute executable path or command name')
    .option('--arg <args...>', 'Arguments passed to the ACP Agent')
    .action((id: string, options: { name: string; command: string; arg?: string[] }) => {
      try {
        const normalized = validateAcpId(id)
        writeAcpManifest({
          schemaVersion: 1,
          id: normalized,
          name: options.name,
          protocol: 'acp',
          command: options.command,
          args: options.arg ?? [],
          enabled: true,
        })
        writeResult(true, 'agent.add', { agentRef: `acp:${normalized}`, installedByShennian: false })
      } catch (error) {
        writeResult(false, 'agent.add', undefined, error instanceof Error ? error.message : String(error))
      }
    })
}

function registerIntegrationRemove(command: Command): void {
  command.description('Remove a local ACP Agent registration (does not uninstall it)')
    .action((id: string) => {
      try {
        const normalized = validateAcpId(id)
        const removed = removeAcpManifest(normalized)
        writeResult(removed, 'agent.remove', removed ? { agentRef: `acp:${normalized}` } : undefined,
          removed ? undefined : `No local ACP Agent named "${normalized}" exists.`)
      } catch (error) {
        writeResult(false, 'agent.remove', undefined, error instanceof Error ? error.message : String(error))
      }
    })
}

function registerIntegrationAuth(command: Command): void {
  command.description('Authenticate an installed ACP Agent on this computer')
    .option('--method <method>', 'Authentication method id')
    .action(async (id: string, options: { method?: string }) => {
      let adapter: AcpAgentAdapter | null = null
      try {
        const normalized = validateAcpId(id.replace(/^acp:/, ''))
        const detected = await discoverAcpAgents()
        if (!detected.some((item) => item.type === `acp:${normalized}`)) {
          throw new Error(`Installed ACP Agent "${normalized}" was not found.`)
        }
        const created = createAgent(`acp:${normalized}`)
        if (!(created instanceof AcpAgentAdapter)) throw new Error('ACP Agent adapter is unavailable')
        adapter = created
        await adapter.start(`acp-auth-${process.pid}`, process.cwd())
        const methods = adapter.getAuthMethods()
        const method = options.method
          ? methods.find((item) => item.id === options.method)
          : methods.length === 1 ? methods[0] : undefined
        if (!method) {
          throw new Error(methods.length
            ? `Choose an authentication method with --method: ${methods.map((item) => item.id).join(', ')}`
            : 'This ACP Agent did not advertise an authentication method.')
        }
        await adapter.authenticate(method.id, { interactiveTerminal: true })
        let resumed = false
        try {
          const result = await callDaemonIpc<{ resumed: boolean }>({
            method: 'agent.auth.completed',
            params: { agentType: `acp:${normalized}` },
          })
          resumed = result.resumed
        } catch {
          // Authentication is still successful when no daemon is currently running.
        }
        writeResult(true, 'agent.auth', { agentRef: `acp:${normalized}`, authenticated: true, resumed })
      } catch (error) {
        writeResult(false, 'agent.auth', undefined, error instanceof Error ? error.message : String(error))
      } finally {
        await adapter?.stop().catch(() => {})
      }
    })
}

function writeResult(ok: boolean, command: string, result?: unknown, error?: string): void {
  process.stdout.write(`${JSON.stringify(ok ? { ok, command, result } : {
    ok, command, error: 'acp_agent_manifest_error', message: error, nextAction: null,
  })}\n`)
  if (!ok) process.exitCode = 1
}
