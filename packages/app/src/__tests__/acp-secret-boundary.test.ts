// @arch docs/features/acp-agent-support.md
// @covers src/features/machines/screens/MachineAgentsScreen.tsx
// @covers open-source/packages/wire/src/session.ts

import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (relative: string) => fs.readFileSync(path.resolve(__dirname, relative), 'utf8')

describe('ACP mobile secret boundary', () => {
  it('projects only non-secret auth method metadata onto the App wire surface', () => {
    const wire = read('../../../../open-source/packages/wire/src/session.ts')
    const start = wire.indexOf('export type AcpAuthMethodSummary')
    const end = wire.indexOf('\n}', start) + 2
    const summary = wire.slice(start, end)
    expect(summary).toContain('id: string')
    expect(summary).toContain('name: string')
    expect(summary).toContain("type: 'agent' | 'terminal'")
    expect(summary).not.toMatch(/token|secret|deviceCode|apiKey|output/i)
  })

  it('never renders a credential, device code, auth URL or terminal output in Agent details', () => {
    const screen = read('../features/machines/screens/MachineAgentsScreen.tsx')
    expect(screen).toContain("'agent.auth.start'")
    expect(screen).not.toMatch(/response\.payload\.(?:token|secret|deviceCode|apiKey|authUrl|terminalOutput)/)
    expect(screen).not.toContain('JSON.stringify(response.payload)')
  })
})
