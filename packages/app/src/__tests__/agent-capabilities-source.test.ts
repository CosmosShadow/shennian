// @covers packages/app/src/features/chat/hooks/useAgentCapabilities.ts
// @covers packages/app/src/features/chat/components/AgentCapabilityPickerSheet.tsx

import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(__dirname, relativePath), 'utf8')
}

describe('Agent native capabilities picker', () => {
  it('reads capabilities from the selected machine without installing anything', () => {
    const source = readSource('../features/chat/hooks/useAgentCapabilities.ts')
    expect(source).toContain("method: 'agent.capabilities.list'")
    expect(source).toContain('params: { agentType, workDir }')
    expect(source).not.toContain("method: 'skill.install'")
    expect(source).not.toContain('/skills')
  })

  it('inserts the native invocation into the draft and never sends automatically', () => {
    const source = readSource('../features/chat/hooks/useAgentCapabilities.ts')
    expect(source).toContain('capability.invocation')
    expect(source).toContain('appendCapabilityInvocation(previous, capability.invocation)')
    expect(source).not.toContain("method: 'chat.send'")
    expect(source).not.toContain("method: 'chat.enqueue'")
  })

  it('limits the first release to Codex, Claude Code, and WorkBuddy', () => {
    const source = readSource('../features/chat/hooks/useAgentCapabilities.ts')
    expect(source).toContain("new Set(['codex', 'claude', 'workbuddy'])")
  })
})
