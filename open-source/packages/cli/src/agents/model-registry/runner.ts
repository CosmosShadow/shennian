// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/model-switching.test.ts

import type { ResolvedCommandSpec } from '../command-spec.js'
import { spawnResolvedCommand } from '../command-spec.js'
import { DISCOVERY_WORKDIR } from './types.js'
import { buildAgentProcessEnv } from '../../agent-env.js'

export function runResolvedCommand(
  spec: ResolvedCommandSpec,
  args: string[],
  timeoutMs = 15_000,
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const proc = spawnResolvedCommand(spec, args, {
      cwd: DISCOVERY_WORKDIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: buildAgentProcessEnv({ NO_COLOR: '1' }),
    })

    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      proc.kill('SIGKILL')
    }, timeoutMs)

    proc.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    proc.on('error', reject)
    proc.on('close', (exitCode) => {
      clearTimeout(timer)
      resolve({ stdout, stderr, exitCode })
    })
  })
}
