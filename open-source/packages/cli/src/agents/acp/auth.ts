// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/acp-auth.test.ts

import { spawn, type StdioOptions } from 'node:child_process'
import type { AuthMethodTerminal } from '@agentclientprotocol/sdk'
import type { AcpLaunchSpec } from './types.js'
import { buildCommandStringLaunchSpec } from '../command-spec.js'

export async function runAcpTerminalAuthentication(
  launch: AcpLaunchSpec,
  method: AuthMethodTerminal,
  cwd: string,
  options: { requireTty?: boolean; stdio?: StdioOptions } = {},
): Promise<void> {
  if (options.requireTty !== false && (!process.stdin.isTTY || !process.stdout.isTTY)) {
    throw new Error('ACP terminal authentication requires an interactive terminal')
  }
  const resolved = buildCommandStringLaunchSpec(
    launch.command,
    [...(launch.args ?? []), ...(method.args ?? [])],
    cwd,
  )
  await new Promise<void>((resolve, reject) => {
    const child = spawn(resolved.command, resolved.args ?? [], {
      cwd,
      env: { ...process.env, ...launch.env, ...method.env },
      stdio: options.stdio ?? 'inherit',
      windowsHide: false,
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => code === 0
      ? resolve()
      : reject(new Error(`ACP terminal authentication failed (${code ?? signal ?? 'unknown'})`)))
  })
}
