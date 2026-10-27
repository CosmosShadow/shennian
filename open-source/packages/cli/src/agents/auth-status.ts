// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/agent-config-status.test.ts
import type { AgentAuthState, BuiltinAgentType } from '@shennian/wire'
import { buildAgentProcessEnv } from '../agent-env.js'
import { buildManagedAgentEnv } from './config-status.js'
import { spawnResolvedCommand, type ResolvedCommandSpec } from './command-spec.js'

// Parse locally, then discard provider output (which may contain account details).
// Credentials present is an identity check, not proof of quota/model availability.
export function parseBuiltinAuthStatus(
  agent: 'codex' | 'claude',
  code: number | null,
  stdout: string,
  stderr: string,
): AgentAuthState {
  if (agent === 'claude') {
    try {
      const value = JSON.parse(stdout)
      if (value?.loggedIn === true && code === 0) return 'ready'
      if (value?.loggedIn === false && code === 1) return 'required'
    } catch {
      /* Unsupported old versions and arbitrary launcher output stay unknown. */
    }
    return 'unknown'
  }
  const output = `${stdout}\n${stderr}`.replace(/\u001b\[[0-9;]*m/g, '')
  if (code === 0 && /\bLogged in (?:using|with)\b/i.test(output)) return 'ready'
  if (code === 1 && /\bNot logged in\b/i.test(output)) return 'required'
  return 'unknown'
}

export async function probeBuiltinAuthStatus(
  agent: BuiltinAgentType,
  spec: ResolvedCommandSpec,
  version?: string,
): Promise<AgentAuthState> {
  if ((agent !== 'codex' && agent !== 'claude') || !version) return 'unknown'
  return new Promise<AgentAuthState>((resolve) => {
    let stdout = '',
      stderr = '',
      complete = false
    const finish = (result: AgentAuthState) => {
      if (complete) return
      complete = true
      clearTimeout(timer)
      stdout = ''
      stderr = ''
      resolve(result)
    }
    const child = spawnResolvedCommand(
      spec,
      agent === 'codex' ? ['login', 'status'] : ['auth', 'status'],
      {
        env: buildAgentProcessEnv(buildManagedAgentEnv(agent)),
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish('unknown')
    }, 5000)
    const capture = (part: 'out' | 'err', data: Buffer) => {
      if (complete) return
      if (stdout.length + stderr.length + data.length > 32768) {
        child.kill('SIGKILL')
        finish('unknown')
        return
      }
      if (part === 'out') stdout += data.toString()
      else stderr += data.toString()
    }
    child.stdout?.on('data', (data) => capture('out', data))
    child.stderr?.on('data', (data) => capture('err', data))
    child.once('error', () => finish('unknown'))
    child.once('close', (code) => finish(parseBuiltinAuthStatus(agent, code, stdout, stderr)))
  }).catch(() => 'unknown')
}
