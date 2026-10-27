// @arch docs/features/desktop-local-first-client.md#33-进程职责
// Expo resolves the platform entry; non-platform tooling uses Native.
export { sessionAccountClient } from './sessionAccountClient.native'
export type { SessionAccountClient, SessionChanges, SessionCreateInput } from './sessionAccountClient.types'
