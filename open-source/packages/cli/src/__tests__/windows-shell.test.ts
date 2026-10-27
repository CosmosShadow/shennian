// @arch open-source/docs/cli-runtime.md
// @covers src/windows-shell.ts

import { describe, expect, it } from 'vitest'
import path from 'node:path'
import {
  buildWindowsSystemEnv,
  resolveWindowsPowerShellPath,
  resolveWindowsSystemRoot,
} from '../windows-shell'

describe('Windows shell helpers', () => {
  it('resolves PowerShell from SystemRoot without relying on PATH', () => {
    const powerShellPath = path.win32.join(
      'D:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    )

    expect(resolveWindowsPowerShellPath({
      env: { SystemRoot: 'D:\\Windows', PATH: '' },
      exists: (filePath) => filePath === powerShellPath,
    })).toBe(powerShellPath)
  })

  it('falls back to the default Windows root when env is sparse', () => {
    expect(resolveWindowsSystemRoot({})).toBe('C:\\Windows')
    expect(buildWindowsSystemEnv({})).toEqual({
      SystemRoot: 'C:\\Windows',
      WINDIR: 'C:\\Windows',
      ComSpec: 'C:\\Windows\\System32\\cmd.exe',
    })
  })
})
