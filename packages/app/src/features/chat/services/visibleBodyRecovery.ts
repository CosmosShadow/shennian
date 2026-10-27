// @arch docs/architecture/data-sync.md#8-app-级统一正文副本与列表发布屏障
// @test src/__tests__/personal-body-replica-sync.test.ts

import type { SessionActivitySnapshot } from '@shennian/wire'

type ReplicaFailureStage =
  | 'reconcile'
  | 'session_sync'
  | 'stream_subscribe'
  | 'stream_event'
  | 'stream_unsubscribe'
  | 'visible_sync'

/** Log only routing metadata. Error messages can contain provider or transport details. */
export function reportPersonalBodyReplicaFailure(
  stage: ReplicaFailureStage,
  input: { sessionId?: string; machineId?: string; error?: unknown },
): void {
  console.warn('[PersonalBodyReplica] operation failed', {
    stage,
    sessionId: input.sessionId,
    machineId: input.machineId,
    errorType: input.error instanceof Error ? input.error.name : typeof input.error,
  })
}

export function shouldRecoverVisibleBodyAfterRun(
  previous: SessionActivitySnapshot | null | undefined,
  current: SessionActivitySnapshot | null | undefined,
  isScreenFocused: boolean,
): boolean {
  return isScreenFocused && Boolean(previous) && !current
}
