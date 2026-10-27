// @arch docs/features/desktop-local-first-client.md#33-进程职责
// Non-platform tooling resolves this file; Expo resolves .native.ts/.web.ts first.

export { agentAccountClient } from './agentAccountClient.native'
export { isAgentAccountNotFound } from './agentAccountClient.types'
export type { AgentAccountClient } from './agentAccountClient.types'
