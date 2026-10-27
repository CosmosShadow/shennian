// @covers src/agents/runtime-compatibility.ts

import { describe, expect, it, vi } from 'vitest'
import { getAgentRuntimeSummary } from '../agents/runtime-compatibility.js'

describe('Agent runtime compatibility', () => {
  it('reports a manual Codex upgrade hint when CLI and Desktop versions differ', () => {
    const getVersion = vi.fn(() => '0.149.0-alpha.4.3')
    const summary = getAgentRuntimeSummary(
      { type: 'codex', version: '0.145.0' },
      {
        platform: 'darwin',
        homeDir: '/Users/demo',
        exists: (filePath) => filePath === '/Applications/ChatGPT.app/Contents/Resources/codex',
        getVersion,
      },
    )

    expect(summary).toEqual({
      cliVersion: '0.145.0',
      desktopVersion: '0.149.0-alpha.4.3',
      compatibility: 'version_mismatch',
      upgradeAction: 'manual',
    })
    expect(getVersion).toHaveBeenCalledTimes(1)
  })

  it('reports matching versions without suggesting an upgrade', () => {
    expect(getAgentRuntimeSummary(
      { type: 'codex', version: '0.149.0' },
      { platform: 'darwin', exists: () => true, getVersion: () => '0.149.0' },
    )).toEqual({
      cliVersion: '0.149.0',
      desktopVersion: '0.149.0',
      compatibility: 'compatible',
    })
  })

  it('reports ordinary Agent CLI versions without inventing desktop compatibility', () => {
    expect(getAgentRuntimeSummary({ type: 'claude', version: '2.1.239' })).toEqual({
      cliVersion: '2.1.239',
    })
  })

  it('never probes Windows Store Codex as a desktop runtime', () => {
    const exists = vi.fn(() => true)
    const getVersion = vi.fn(() => '0.154.0')
    expect(getAgentRuntimeSummary(
      { type: 'codex', version: '0.153.0' },
      { platform: 'win32', exists, getVersion },
    )).toEqual({ cliVersion: '0.153.0' })
    expect(exists).not.toHaveBeenCalled()
    expect(getVersion).not.toHaveBeenCalled()
  })
})
