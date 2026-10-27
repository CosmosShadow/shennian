// @covers src/features/chat/screens/ChatScreen.tsx

import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('ACP session options', () => {
  it('loads runtime model and mode choices only for an active ACP session', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../features/chat/screens/ChatScreen.tsx'),
      'utf8',
    )
    expect(source).toContain("'agent.session-options.get'")
    expect(source).toContain("agentType.startsWith('acp:')")
    expect(source).toContain('acpSessionOptions.models')
    expect(source).toContain('supportedReasoningEfforts: acpSessionOptions.modes')
  })
})
