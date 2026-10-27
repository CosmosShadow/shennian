// @arch open-source/docs/cli-runtime.md
//
// Constants shared between claude.ts (the parent process, which only needs
// the names to build CLI args) and claude-permission-relay-server.ts (the
// child MCP process it spawns). Kept side-effect-free and separate from the
// relay server itself so importing these names never pulls in that server's
// top-level stdin listener.

export const CLAUDE_PERMISSION_TOOL_NAME = 'approve'
export const CLAUDE_USER_INPUT_TOOL_NAME = 'request_user_input'
export const CLAUDE_PERMISSION_MCP_SERVER_NAME = 'shennianPermission'
export const CLAUDE_PERMISSION_SOCKET_ENV = 'SHENNIAN_CLAUDE_PERMISSION_SOCKET'
