// @arch docs/architecture/data-sync.md#8-app-级统一正文副本与列表发布屏障

const listeners = new Set<(sessionId?: string) => void>()

export function publishPersonalBodyReplicaTargetChange(sessionId?: string): void {
  for (const listener of listeners) listener(sessionId)
}

export function subscribePersonalBodyReplicaTargetChange(listener: (sessionId?: string) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
