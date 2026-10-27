// @covers src/agents/acp/auth.ts

import { describe, expect, it } from 'vitest'
import { runAcpTerminalAuthentication } from '../agents/acp/auth.js'

describe('ACP terminal authentication', () => {
  it('treats zero as success and a non-zero exit as failure', async () => {
    const method = { id: 'terminal', name: 'Terminal', type: 'terminal' as const }
    await expect(runAcpTerminalAuthentication(
      { command: process.execPath, args: ['-e', 'process.exit(0)'] },
      method,
      process.cwd(),
      { requireTty: false, stdio: 'ignore' },
    )).resolves.toBeUndefined()
    await expect(runAcpTerminalAuthentication(
      { command: process.execPath, args: ['-e', 'process.exit(7)'] },
      method,
      process.cwd(),
      { requireTty: false, stdio: 'ignore' },
    )).rejects.toThrow('(7)')
  })
})
