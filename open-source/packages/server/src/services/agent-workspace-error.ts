// @arch open-source/docs/server-runtime.md
// @test src/__tests__/agent-workspaces.test.ts

export class AgentWorkspaceError extends Error {
  constructor(
    public readonly code: 'invalid' | 'not_found' | 'forbidden',
    message: string,
  ) {
    super(message)
  }
}
