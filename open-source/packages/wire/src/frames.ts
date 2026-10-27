import type { ReqMethod } from './methods.ts'
import type { SessionSyncRejection } from './session-sync.ts'

export type ReqFrame = {
  type: 'req'
  id: string
  method: ReqMethod
  params: Record<string, unknown>
  traceId?: string
}

export type ResFrame = {
  type: 'res'
  id: string
  ok: boolean
  payload?: unknown
  error?: string
  /** Structured, machine-actionable rejection. Clients must not parse `error`. */
  rejection?: SessionSyncRejection
  traceId?: string
}

export type EventFrame = {
  type: 'event'
  event: string
  payload?: unknown
  seq?: number
  id?: string
  traceId?: string
}

export type Frame = ReqFrame | ResFrame | EventFrame

export type RoutedFrame = {
  type: 'relay'
  machineId: string
  frame: Frame
}
