// @arch open-source/docs/cli-runtime.md
// @covers open-source/packages/cli/src/commands/upgrade.ts

import { describe, expect, it, vi } from 'vitest'
import { classifyBidirectionalVersionChange, hasMajorUpgradeConfirmation, restartCurrentDaemonAfterUpgrade } from '../commands/upgrade.js'

describe('upgrade command restart helpers', () => {
  it('starts a delayed hidden Windows launcher before terminating the old daemon', () => {
    const unref = vi.fn()
    const spawn = vi.fn(() => ({ unref }))
    const kill = vi.fn()

    restartCurrentDaemonAfterUpgrade({
      platform: 'win32',
      pid: 1234,
      spawn: spawn as any,
      kill: kill as any,
      env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
    })

    expect(spawn).toHaveBeenCalledWith(
      'C:\\Windows\\System32\\cmd.exe',
      [
        '/d',
        '/s',
        '/c',
        'timeout /t 2 /nobreak >nul & schtasks /Run /TN ShennianAgent >nul',
      ],
      expect.objectContaining({
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      }),
    )
    expect(unref).toHaveBeenCalled()
    expect(kill).toHaveBeenCalledWith(1234, 'SIGTERM')
  })

  it('falls back to running the Windows scheduled task when delayed spawn fails', () => {
    const spawn = vi.fn(() => {
      throw new Error('spawn failed')
    })
    const execSync = vi.fn()
    const kill = vi.fn()

    restartCurrentDaemonAfterUpgrade({
      platform: 'win32',
      pid: 5678,
      spawn: spawn as any,
      execSync: execSync as any,
      kill: kill as any,
      env: {},
    })

    expect(execSync).toHaveBeenCalledWith('schtasks /run /tn "ShennianAgent"', {
      stdio: 'pipe',
      windowsHide: true,
    })
    expect(kill).toHaveBeenCalledWith(5678, 'SIGTERM')
  })

  it('starts a delayed launcher before terminating on Unix platforms', () => {
    const unref = vi.fn()
    const spawn = vi.fn(() => ({ unref }))
    const kill = vi.fn()

    restartCurrentDaemonAfterUpgrade({
      platform: 'linux',
      pid: 9012,
      spawn: spawn as any,
      kill: kill as any,
    })

    expect(spawn).toHaveBeenCalledWith(
      'sh',
      ['-c', 'sleep 2; shennian start >/dev/null 2>&1'],
      expect.objectContaining({
        detached: true,
        stdio: 'ignore',
      }),
    )
    expect(unref).toHaveBeenCalled()
    expect(kill).toHaveBeenCalledWith(9012, 'SIGTERM')
  })
})

describe('major upgrade confirmation', () => {
  it('classifies downgrades and requires confirmation for a major downgrade', () => {
    expect(classifyBidirectionalVersionChange('1.2.3', '1.2.2')).toBe('patch')
    expect(classifyBidirectionalVersionChange('1.2.3', '1.1.9')).toBe('minor')
    expect(classifyBidirectionalVersionChange('2.0.0', '1.9.9')).toBe('major')
    expect(hasMajorUpgradeConfirmation(classifyBidirectionalVersionChange('2.0.0', '1.9.9'), false)).toBe(false)
  })
  it('requires a second explicit confirmation only for major versions', () => {
    expect(hasMajorUpgradeConfirmation('major', false)).toBe(false)
    expect(hasMajorUpgradeConfirmation('major', true)).toBe(true)
    expect(hasMajorUpgradeConfirmation('minor', false)).toBe(true)
    expect(hasMajorUpgradeConfirmation('patch', false)).toBe(true)
  })
})
