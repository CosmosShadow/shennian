// @arch docs/features/desktop-local-first-client.md#33-进程职责
// Non-platform tooling resolves this file; Expo resolves .native.ts/.web.ts first.

export { profileAccountClient } from './profileAccountClient.native'
export type {
  ProfileAccountClient,
  ProfileAvatar,
  ProfileDevice,
  ProfileDeviceClient,
} from './profileAccountClient.types'
