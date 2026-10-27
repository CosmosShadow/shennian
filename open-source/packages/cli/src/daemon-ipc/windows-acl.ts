// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/daemon-ipc-windows-acl.test.ts

import { execFileSync } from 'node:child_process'
import { DaemonIpcError } from './protocol.js'

const WINDOWS_PIPE_ENDPOINT = /^\\\\\.\\pipe\\shennian-daemon-[a-f0-9]{20}$/
type PipeAclRunner = (
  file: string,
  args: readonly string[],
  options: { encoding: 'utf8'; stdio: ['ignore', 'pipe', 'ignore']; timeout: number; windowsHide: boolean },
) => string

/**
 * An S4U task runs in a different logon session from its user's desktop. Node's
 * default pipe ACL is therefore too narrow, while readableAll/writableAll would
 * grant every local user access. Grant the account SID explicitly instead.
 */
export function secureWindowsDaemonPipe(
  endpoint: string,
  run: PipeAclRunner = execFileSync,
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform !== 'win32' || !WINDOWS_PIPE_ENDPOINT.test(endpoint)) {
    throw new DaemonIpcError('ipc_acl_setup_failed', 'Invalid Windows daemon IPC endpoint.')
  }
  const script = buildWindowsPipeAclScript(endpoint)
  try {
    const result = run('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 15_000,
      windowsHide: true,
    })
    if (String(result).trim() !== 'ACL_OK') throw new Error('unexpected_acl_result')
  } catch {
    throw new DaemonIpcError('ipc_acl_setup_failed', 'Could not secure the Windows daemon IPC endpoint.')
  }
}

export function buildWindowsPipeAclScript(endpoint: string): string {
  if (!WINDOWS_PIPE_ENDPOINT.test(endpoint)) {
    throw new DaemonIpcError('ipc_acl_setup_failed', 'Invalid Windows daemon IPC endpoint.')
  }
  return `$ErrorActionPreference = 'Stop'
$endpoint = '${endpoint}'
$code = @'
using System;
using System.Runtime.InteropServices;
public static class ShennianPipeAcl {
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(string sddl, uint revision, out IntPtr descriptor, out uint size);
  [DllImport("advapi32.dll", SetLastError = true)]
  public static extern bool GetSecurityDescriptorDacl(IntPtr descriptor, out bool present, out IntPtr dacl, out bool defaulted);
  [DllImport("advapi32.dll", SetLastError = true)]
  public static extern uint SetSecurityInfo(IntPtr handle, int objectType, uint securityInfo, IntPtr owner, IntPtr group, IntPtr dacl, IntPtr sacl);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern IntPtr CreateFile(string name, uint access, uint shareMode, IntPtr security, uint creation, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll")]
  public static extern IntPtr LocalFree(IntPtr pointer);
}
'@
Add-Type -TypeDefinition $code -ErrorAction Stop
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$sddl = 'D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GA;;;' + $sid + ')'
$descriptor = [IntPtr]::Zero
$size = [uint32]0
if (-not [ShennianPipeAcl]::ConvertStringSecurityDescriptorToSecurityDescriptor($sddl, 1, [ref]$descriptor, [ref]$size)) { exit 2 }
try {
  $present = $false
  $defaulted = $false
  $dacl = [IntPtr]::Zero
  if (-not [ShennianPipeAcl]::GetSecurityDescriptorDacl($descriptor, [ref]$present, [ref]$dacl, [ref]$defaulted) -or -not $present -or $dacl -eq [IntPtr]::Zero) { exit 3 }
  $handle = [ShennianPipeAcl]::CreateFile($endpoint, 0x00060000, 3, [IntPtr]::Zero, 3, 0, [IntPtr]::Zero)
  if ($handle -eq [IntPtr](-1)) { exit 4 }
  try {
    if ([ShennianPipeAcl]::SetSecurityInfo($handle, 6, 4, [IntPtr]::Zero, [IntPtr]::Zero, $dacl, [IntPtr]::Zero) -ne 0) { exit 5 }
  } finally {
    [void][ShennianPipeAcl]::CloseHandle($handle)
  }
} finally {
  [void][ShennianPipeAcl]::LocalFree($descriptor)
}
'ACL_OK'
`
}
