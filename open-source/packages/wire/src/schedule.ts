// @arch open-source/docs/wire.md
// @test open-source/packages/cli/src/__tests__/conversation-schedules.test.ts
export type ScheduleExecutionMode = 'main' | 'worker'

// Optional metadata in the existing rule JSON; old schedules keep main execution.
export type ScheduleRule = (
  | { kind: 'once'; at: number }
  | { kind: 'interval'; anchor: number; everyMs: number }
  | { kind: 'calendar'; hour: number; minute: number; weekdays?: number[]; monthDay?: number }
) & { executionMode?: ScheduleExecutionMode }

export type ConversationSchedule = {
  id: string
  sessionId: string
  bindingId?: string
  roomId?: string
  agentIdentityId?: string
  /** 'room' (default): a managed-Room agent's task. 'steward': bound to machineId instead of a session. */
  scope: 'room' | 'steward'
  machineId?: string
  executionMode?: ScheduleExecutionMode
  prompt: string
  timeDescription: string
  timezone: string
  rule: ScheduleRule
  state: 'active' | 'paused' | 'ended' | 'deleted'
  version: number
  nextDueAt: number | null
  createdAt: number
  updatedAt: number
  last?: { at: number; state: 'delivered' | 'skipped' | 'failed' | 'dispatching'; reason?: string; messageId?: string }
}
export type ScheduleAction = 'list' | 'create' | 'update' | 'pause' | 'resume' | 'delete'
