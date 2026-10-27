// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/session-manager-error-handling-1.test.ts

import type { ManagedWorkerRoomOrigin } from '../manager/registry.js'

export type ManagedRoomTriggerContext = {
  registryKey: string
  causeMessageId: string
  rootCauseMessageId: string
  sequence: string
  hopCount: number
}

export type TurnTrigger =
  | { kind: 'scheduled'; taskId: string; bindingId?: string; roomId?: string }
  | { kind: 'personal' }
  | { kind: 'managed_direct' }
  | ({ kind: 'room_activation' } & ManagedRoomTriggerContext)
  | { kind: 'manager_event'; eventId: string; roomOrigin?: ManagedWorkerRoomOrigin }
  | { kind: 'manager_worker'; parentSessionId: string; roomOrigin?: ManagedWorkerRoomOrigin }

export type RecoveryAuthority =
  | { kind: 'personal' }
  | { kind: 'managed_direct' }
  | ({ kind: 'room_activation' } & ManagedRoomTriggerContext)
  | { kind: 'manager_event'; eventId: string; roomOrigin?: ManagedWorkerRoomOrigin }
  | { kind: 'manager_worker'; parentSessionId: string; roomOrigin?: ManagedWorkerRoomOrigin }
