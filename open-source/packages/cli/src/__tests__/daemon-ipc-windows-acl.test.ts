// @covers open-source/packages/cli/src/daemon-ipc/windows-acl.ts

import { describe, expect, it, vi } from 'vitest'
import { buildWindowsPipeAclScript, secureWindowsDaemonPipe } from '../daemon-ipc/windows-acl.js'

const endpoint = '\\\\.\\pipe\\shennian-daemon-0123456789abcdefabcd'

describe('Windows daemon pipe ACL', () => {
  it('grants only SYSTEM, Administrators and the current account SID', () => {
    const script = buildWindowsPipeAclScript(endpoint)
    expect(script).toContain('[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value')
    expect(script).toContain('D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GA;;;')
    expect(script).toContain('SetSecurityInfo($handle, 6, 4')
    expect(script).not.toMatch(/readableAll|writableAll|\(A;;GA;;;WD\)/)
  })

  it('runs the ACL change with a bounded hidden PowerShell child and requires its success marker', () => {
    const run = vi.fn().mockReturnValue('ACL_OK\r\n')
    expect(() => secureWindowsDaemonPipe(endpoint, run, 'win32')).not.toThrow()
    expect(run).toHaveBeenCalledOnce()
    const [binary, args, options] = run.mock.calls[0]!
    expect(binary).toBe('powershell.exe')
    expect(args.slice(0, 3)).toEqual(['-NoProfile', '-NonInteractive', '-EncodedCommand'])
    expect(options).toMatchObject({ timeout: 15_000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
    expect(Buffer.from(args[3], 'base64').toString('utf16le')).toContain(endpoint)
  })

  it('fails closed on invalid endpoints, helper failure and unexpected output', () => {
    const run = vi.fn().mockReturnValue('ACL_OK')
    expect(() => secureWindowsDaemonPipe('\\\\.\\pipe\\another-user', run, 'win32'))
      .toThrowError(expect.objectContaining({ code: 'ipc_acl_setup_failed' }))
    expect(run).not.toHaveBeenCalled()
    expect(() => secureWindowsDaemonPipe(endpoint, () => { throw new Error('denied') }, 'win32'))
      .toThrowError(expect.objectContaining({ code: 'ipc_acl_setup_failed' }))
    expect(() => secureWindowsDaemonPipe(endpoint, () => 'no', 'win32'))
      .toThrowError(expect.objectContaining({ code: 'ipc_acl_setup_failed' }))
  })
})
