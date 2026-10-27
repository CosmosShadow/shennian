// Non-platform tooling resolves this file; Expo resolves .native.ts or .web.ts first.
export { roomAccountClient } from './roomAccountClient.native'
export type {
  RoomBrowserSession,
  RoomInviteLink,
  RoomJoinRequest,
} from './roomAccountClient.types'
export {
  isRoomAccountForbidden,
  isRoomAccountNotFound,
} from './roomAccountClient.types'
