// @covers src/room/activation-service.ts

export function testPermissionPolicy() {
  return {
    version: 1,
    fileAccess: 'workspace-write' as const,
    externalCapabilities: {
      commandNetwork: false,
      webSearch: false,
      browser: false,
      computerUse: false,
      mcp: false,
    },
  }
}
