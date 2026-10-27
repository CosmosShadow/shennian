// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/pi-coding-agent-managed-permissions.test.ts

import type { ManagedAgentRuntimeSecurityDeclaration } from '../security/managed-agent-runtime.js'

/** Pi's native tool allowlist is useful but is not a process sandbox. The
 * declaration deliberately reports host-wide reachability because Bash can
 * cross filesystem, network, socket and GUI boundaries on every supported
 * platform. Shennian may still apply a narrower authorization ceiling, but the
 * UI must present the gap as partial protection. */
export const PI_CODING_AGENT_MANAGED_RUNTIME_SECURITY: ManagedAgentRuntimeSecurityDeclaration = {
  minimumRuntimeVersion: '0.85.0',
  maximumRuntimeVersionExclusive: '0.86.0',
  platforms: Object.fromEntries(
    (['darwin', 'linux', 'wsl', 'win32'] as const).map((platform) => [
      platform,
      {
        level: 'partial' as const,
        fileAccess: {
          'workspace-read': false,
          'workspace-write': false,
          'host-full': true,
        },
        externalCapabilities: {
          commandNetwork: { allow: true, deny: false },
          webSearch: { allow: true, deny: false },
          browser: { allow: true, deny: false },
          computerUse: { allow: true, deny: false },
          mcp: { allow: true, deny: false },
        },
        knownGaps: [
          'sandbox.toolAllowlistOnly',
          'shell.hostFilesystemReachable',
          'shell.networkReachable',
          'shell.localSocketsReachable',
        ],
      },
    ]),
  ),
}
