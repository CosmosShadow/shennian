// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/daemon-control-ipc.test.ts
import type { Command } from 'commander'
import { callDaemonIpc } from '../daemon-ipc/client.js'
import { DaemonIpcError } from '../daemon-ipc/protocol.js'
import type { JsonValue } from '../daemon-ipc/json.js'

const nextActions: Record<string, string> = {
  method_not_found: 'Update the existing Shennian installation: Desktop through Desktop updates, standalone CLI through its own update flow. Do not install a second Client.',
  daemon_unavailable: 'Check shennian status --json on the target computer, including ipc.state. A running PID and paired account do not prove local IPC is available. Check the Client version, service account and logs; do not force-stop or resume an intentional pause.',
  ipc_access_denied: 'The daemon IPC endpoint denied this user. Check whether the command and Windows scheduled task run under the same account and inspect the task/logs; do not force-stop the daemon.',
  ipc_connection_failed: 'The daemon IPC connection failed. Check shennian status --json (ipc.state), the Client version and daemon logs before retrying.',
  daemon_paused: 'Shennian is paused. Ask the user to resume it before checking.',
  ipc_timeout: 'The daemon did not answer in time, so the result is unknown; the machine is usually overloaded. Check its load and memory (uptime, free -m) and wait for the running check to end; do not repeatedly send tests. If the AI\'s own processes are still running afterwards, stop only those exact processes.',
  agent_check_in_progress: 'Wait for the running check to finish before trying again.',
  agent_validation_runtime_unavailable: 'Refresh discovery. If the tool is still missing, guide the user through its official installation on this computer.',
  agent_validation_runtime_auth_required: 'Guide the user through the provider’s own sign-in on this computer, then retry the selected AI and model.',
  agent_validation_model_unavailable: 'Choose a model returned by discovery and check the provider account’s model access.',
  agent_validation_quota_exceeded: 'Check the provider account’s credits, subscription or rate limit before another test.',
  agent_validation_network_failed: 'Check the target computer’s connection to the provider, then retry when it is available.',
  agent_validation_workdir_invalid: 'Use an existing absolute project directory on this computer that the user allows Shennian to use.',
  agent_validation_workdir_not_found: 'The working directory does not exist on this computer. Ask the user for an existing absolute project directory (it may have been moved, deleted or is on an unmounted drive); do not create it for them.',
  agent_validation_workdir_not_directory: 'The working directory path is a file, not a folder. Ask the user for the project folder.',
  agent_validation_workdir_unavailable: 'The working directory exists but this user cannot access it. Check its permissions on this computer or choose another directory.',
  agent_validation_start_failed: 'The AI could not start, or did not finish starting within 60 seconds. Run the tool once on this computer to see its own error, fix its installation or configuration, then retry once.',
  agent_validation_response_timeout: 'The AI started but gave no hello reply within 60 seconds and its processes were stopped. Check the computer\'s load and free memory first, then its provider sign-in, selected model and network; retry once and do not repeatedly send tests.',
  agent_validation_response_mismatch: 'The AI replied but not with hello. Check the selected model; a reply that ignores simple instructions usually means a wrong or misconfigured model.',
  agent_validation_response_failed: 'The AI started but failed while replying. Check its provider sign-in, selected model, quota and network, then retry once.',
}

// Where a failed check stopped, so the caller sees the cause without parsing codes.
const failureStages: Record<string, string> = {
  agent_validation_runtime_unavailable: 'start',
  agent_validation_workdir_invalid: 'start',
  agent_validation_workdir_not_found: 'start',
  agent_validation_workdir_not_directory: 'start',
  agent_validation_workdir_unavailable: 'start',
  agent_validation_start_failed: 'start',
  agent_validation_runtime_auth_required: 'auth',
  agent_validation_model_unavailable: 'model',
  agent_validation_quota_exceeded: 'quota',
  agent_validation_network_failed: 'network',
  agent_validation_response_timeout: 'reply',
  agent_validation_response_mismatch: 'reply',
  agent_validation_response_failed: 'reply',
}

const OFFICIAL_ADAPTER_IDS = new Set(['claude', 'codex', 'cursor', 'workbuddy', 'opencode', 'pi-coding-agent'])

function nextActionFor(code: string, params?: JsonValue): string {
  const base = nextActions[code] ??
    'Return to the AI preparation guide on this machine. Check the selected directory, account, model and network; do not reinstall by default.'
  const agentType = params && typeof params === 'object' && !Array.isArray(params) &&
    typeof params.agentType === 'string' ? params.agentType : null
  if (!agentType || !OFFICIAL_ADAPTER_IDS.has(agentType) ||
      !['agent_validation_start_failed', 'agent_validation_response_failed', 'agent_validation_response_mismatch'].includes(code)) {
    return base
  }
  return `${base} If the provider's own machine interface works but the official Adapter still fails, read ` +
    `shennian adapter show ${agentType}, create a local V1 file with shennian adapter init, and follow adapter check's ` +
    'structured stage/error/nextAction. Stop after three failed edit/check iterations.'
}

// The daemon answers within AGENT_VALIDATION_MAX_DURATION_MS (68s); keep this wait above it.
export const AGENT_READINESS_IPC_TIMEOUT_MS = 90_000

// A hello reply says nothing about Room chat; discovery fields are only hints.
const CHECK_SCOPE_NOTE = 'A successful check only proves one standard-mode hello reply; it does not prove the AI can send messages in a Room.'
const DISCOVER_FIELD_NOTES = {
  authState: 'unknown means Shennian has no login probe for this AI; it is not "not logged in".',
  defaultModelId: 'null means no model is marked default; it does not mean no model is available. The AI picks its own model when none is passed.',
}
export async function executeAgentReadinessCommand(method: 'agent.discover' | 'agent.check', params?: JsonValue,
  call = callDaemonIpc) {
  try {
    const result = await call({ method, params, timeoutMs: AGENT_READINESS_IPC_TIMEOUT_MS })
    if (method === 'agent.check' && (!result || typeof result !== 'object' || Array.isArray(result) || result.ready !== true)) {
      throw new DaemonIpcError('agent_check_invalid_response', 'The daemon did not confirm a successful hello reply.')
    }
    if (method === 'agent.discover' && result && typeof result === 'object' && !Array.isArray(result)) {
      return { ok: true, command: method, result: { ...result, notes: DISCOVER_FIELD_NOTES } }
    }
    if (method === 'agent.check' && result && typeof result === 'object' && !Array.isArray(result)) {
      return { ok: true, command: method, result: { ...result, note: CHECK_SCOPE_NOTE } }
    }
    return { ok: true, command: method, result }
  } catch (error) {
    const code = error instanceof DaemonIpcError ? error.code : 'agent_check_failed'
    // No answer at all means the check ran out of time waiting for the reply; auth, model and quota
    // failures are answered quickly and keep their own stage.
    const stage = failureStages[code] ?? (method === 'agent.check' && code === 'ipc_timeout' ? 'reply' : undefined)
    return { ok: false, command: method, error: code,
      ...(stage ? { stage } : {}),
      nextAction: nextActionFor(code, params) }
  }
}
export function registerAgentReadinessCommands(agent: Command): void {
  const execute = async (method: 'agent.discover' | 'agent.check', params?: JsonValue) => {
    const result = await executeAgentReadinessCommand(method, params)
    process.stdout.write(`${JSON.stringify(result)}\n`)
    if (!result.ok) process.exitCode = 1
  }
  agent.command('discover').description('Read the daemon AI snapshot; use --refresh only to rerun local provider and model discovery')
    .option('--agent <type>', 'Return only one discovered Agent type')
    .option('--compact', 'Return capability summary without the full model list')
    .option('--refresh', 'Rerun discovery; with --agent, probe only that Agent')
    .option('--json', 'Print JSON (default)')
    .action((options: { agent?: string; compact?: boolean; refresh?: boolean }) => execute('agent.discover', {
      ...(options.agent ? { agentType: options.agent } : {}),
      compact: options.compact === true,
      refresh: options.refresh === true,
    }))
  agent.command('check <agentType>').description('Send one hello test using the selected AI and model; uses provider quota, creates no managed Agent or room')
    .requiredOption('--workdir <path>', 'Absolute project directory on this machine')
    .option('--model <id>', 'Model returned by discovery; otherwise use the provider default')
    .option('--json', 'Print JSON (default)')
    .action((agentType: string, options: { workdir: string; model?: string }) =>
      execute('agent.check', { agentType, workDir: options.workdir, modelId: options.model ?? null }))
}
