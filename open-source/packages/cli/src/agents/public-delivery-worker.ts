// @arch open-source/docs/cli-runtime.md

import { managedAgentConfirmationMatchesPolicy, parseManagedAgentPermissionPolicy, type AgentType,
  type ManagedAgentPermissionPolicy } from '@shennian/wire'
import { createAgent } from './adapter.js'
import type { DetectedAgent } from './detect.js'
import { HttpPublicAgentDeliveryClient, type PublicAgentClaim } from './public-delivery-client.js'
import { runPublicAgentTurn } from './public-turn-runner.js'
import { compileManagedAgentPolicy } from '../security/managed-agent-policy.js'

const POLL_MS = 5_000

type AgentDefinition = {
  id: string; machineId: string; runtimeAdapter: string
  status: string; sessionMode: string; systemPrompt: string; modelId: string | null; workDir: string
  permissionPolicy: ManagedAgentPermissionPolicy
  permissionConfirmation?: unknown
}

function isAgentDefinition(value: unknown): value is AgentDefinition {
  if (!value || typeof value !== 'object') return false
  const agent = value as Record<string, unknown>
  return typeof agent.id === 'string' && typeof agent.machineId === 'string'
    && typeof agent.runtimeAdapter === 'string' && typeof agent.status === 'string'
    && typeof agent.sessionMode === 'string'
    && typeof agent.systemPrompt === 'string'
    && typeof agent.workDir === 'string' && agent.workDir.trim().length > 0
    && (agent.modelId === null || typeof agent.modelId === 'string')
    && parseManagedAgentPermissionPolicy(agent.permissionPolicy) !== null
}

/** Runs on the paired daemon only; each turn uses the saved Agent permission policy. */
export class PublicAgentDeliveryWorker {
  private timer: NodeJS.Timeout | undefined
  private generation = 0
  private running: AbortController | null = null
  private readonly delivery: HttpPublicAgentDeliveryClient

  constructor(private readonly input: {
    serverUrl: string
    machineId: string
    getMachineToken: () => string | undefined
    getDetectedAgents: () => Promise<readonly DetectedAgent[]>
    onRuntimeChanged?: () => Promise<void>
    onError?: (error: unknown) => void
  }) {
    this.delivery = new HttpPublicAgentDeliveryClient(input.serverUrl)
  }

  start(): void {
    if (this.generation % 2 === 1) return
    this.generation += 1
    this.schedule(0, this.generation)
  }

  stop(): void {
    if (this.generation % 2 === 0) return
    this.generation += 1
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    this.running?.abort()
  }

  private schedule(delay: number, generation: number): void {
    if (generation !== this.generation) return
    this.timer = setTimeout(() => void this.tick(generation), delay)
    this.timer.unref?.()
  }

  private async tick(generation: number): Promise<void> {
    if (generation !== this.generation) return
    if (this.running) return this.schedule(POLL_MS, generation)
    const token = this.input.getMachineToken()
    if (!token) return this.schedule(POLL_MS, generation)
    try {
      const claim = await this.delivery.claim(token)
      if (generation !== this.generation) {
        if (claim) await this.delivery.fail({ machineToken: token, claim,
          failureCode: 'execution_failed' }).catch(() => {})
        return
      }
      if (claim) {
        const controller = new AbortController()
        this.running = controller
        try { await this.run(claim, token, controller.signal) }
        finally { this.running = null }
      }
    } catch (error) { this.input.onError?.(error) }
    this.schedule(POLL_MS, generation)
  }

  private async run(claim: PublicAgentClaim, token: string, signal: AbortSignal): Promise<void> {
    let delegated = false
    try {
      const agent = await this.loadAgent(claim.agentIdentityId, token, signal)
      if (signal.aborted) throw new Error('public_agent_turn_aborted')
      if (agent.id !== claim.agentIdentityId || agent.machineId !== this.input.machineId
        || agent.runtimeAdapter !== claim.runtimeAdapter || agent.status !== 'active'
        || agent.sessionMode !== 'standard') {
        throw new Error('public_agent_definition_stale')
      }
      const runtime = (await this.input.getDetectedAgents())
        .find((item) => item.type === claim.runtimeAdapter)
      if (signal.aborted) throw new Error('public_agent_turn_aborted')
      if (!runtime?.executableFingerprint || !runtime.version) {
        throw new Error('public_agent_runtime_unavailable')
      }
      if (runtime.executableFingerprint !== claim.executableFingerprint) {
        // Stop polling before reporting the new machine snapshot. The report
        // pauses affected publications, but it is asynchronous at the Relay.
        this.stop()
        if (this.input.onRuntimeChanged) {
          try { await this.input.onRuntimeChanged() }
          catch (error) { this.input.onError?.(error) }
        }
        throw new Error('public_agent_runtime_changed')
      }
      delegated = true
    await runPublicAgentTurn({
      claim, machineToken: token, delivery: this.delivery, signal, workDir: agent.workDir,
      createAdapter: () => createAgent(claim.runtimeAdapter as AgentType),
      compilePolicy: async (workDir) => {
        const runtimeInput = {
          agentType: claim.runtimeAdapter as AgentType,
          runtimeVersion: runtime.version,
          platform: runtime.runtimePlatform ?? process.platform,
          isWsl: runtime.runtimeIsWsl ?? false,
          executableFingerprint: runtime.executableFingerprint!,
          requireExecutableFingerprint: true,
        }
        const ownerConfirmed = managedAgentConfirmationMatchesPolicy({
          confirmation: agent.permissionConfirmation,
          policy: agent.permissionPolicy,
          runtimeAdapter: claim.runtimeAdapter,
        })
        const result = await compileManagedAgentPolicy({
          ...runtimeInput,
          // Use the Owner's saved Agent ceiling, never an unrelated public
          // default. The public-turn gate still rejects any unapproved mode.
          policy: agent.permissionPolicy,
          hostFullAccessConfirmed: ownerConfirmed,
          channel: 'public',
          workDir,
        })
        if (!result.ok) throw new Error(result.errorCode)
        return result.value
      },
      systemPrompt: agent.systemPrompt,
      modelId: agent.modelId,
      onError: this.input.onError,
    })
    } catch (error) {
      if (!delegated) {
        await this.delivery.fail({ machineToken: token, claim,
          failureCode: 'runtime_unavailable' }).catch(() => {})
      }
      throw error
    }
  }

  private async loadAgent(agentId: string, token: string, signal: AbortSignal): Promise<AgentDefinition> {
    const response = await fetch(`${this.input.serverUrl.replace(/\/+$/, '')}/api/agent-cli/agents/${encodeURIComponent(agentId)}`, {
      headers: { authorization: `Bearer ${token}` },
      redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    })
    if (!response.ok) throw new Error('public_agent_definition_unavailable')
    const body: unknown = await response.json().catch(() => null)
    if (!body || typeof body !== 'object' || !('agent' in body)
      || !isAgentDefinition(body.agent)) throw new Error('public_agent_definition_invalid')
    return body.agent
  }
}
