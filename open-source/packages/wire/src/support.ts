// @arch open-source/docs/wire.md

import type { RoomCliMessageView } from './room.ts'

export type SupportRoomSummary = {
  roomId: string
  name: string
  canonicalUrl: string
}

export type SupportStatusResult = {
  joined: boolean
  room: SupportRoomSummary
}

export type SupportAskResult = {
  outcome: 'sent'
  joinedRoom: boolean
  idempotent: boolean
  room: SupportRoomSummary
  message: RoomCliMessageView
}

export type SupportReadResult = {
  messages: RoomCliMessageView[]
}
