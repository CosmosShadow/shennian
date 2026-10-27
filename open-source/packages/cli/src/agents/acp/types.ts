// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/acp-adapter.test.ts

import type { AcpAgentType } from '@shennian/wire'
import type { AgentCapabilities, AuthMethod, Implementation } from '@agentclientprotocol/sdk'

export type AcpLaunchSpec = {
  command: string
  args?: string[]
  env?: Record<string, string>
}

export type AcpAgentManifest = {
  id: string
  name: string
  launch: AcpLaunchSpec
  /** Original command before platform shim wrapping; used to append terminal-auth args safely. */
  authLaunch?: AcpLaunchSpec
  homepage?: string
  source?: 'registry' | 'local'
  packageHints?: { npm?: string; uv?: string }
  clientCapabilities?: {
    readTextFile?: boolean
    writeTextFile?: boolean
    terminal?: boolean
  }
}

export type AcpInitialization = {
  agentInfo?: Implementation | null
  authMethods: AuthMethod[]
  capabilities: AgentCapabilities
}

export function acpAgentType(id: string): AcpAgentType {
  return `acp:${id}`
}
