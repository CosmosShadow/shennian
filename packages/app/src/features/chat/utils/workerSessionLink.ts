// @arch docs/features/manager-agent.md#九manager-与-worker-的可见-markdown
// @test src/__tests__/chat-webview-script.test.ts

const WORKER_SESSION_URL = /^shennian:\/\/session\/([^/?#]+)$/

export function parseWorkerSessionUrl(value: string): string | null {
  const match = WORKER_SESSION_URL.exec(String(value || '').trim())
  if (!match) return null
  try {
    const sessionId = decodeURIComponent(match[1])
    if (!sessionId || sessionId.length > 256 || !sessionId.startsWith('sess_worker_')) return null
    return sessionId
  } catch {
    return null
  }
}

export function isWorkerSessionUrl(value: string): boolean {
  return parseWorkerSessionUrl(value) !== null
}

type WorkerSessionAuthorizationInput = {
  id: string
  machineId: string
  userId: string
  workDir: string
  canManage?: boolean
}

export function canOpenWorkerSession(
  source: WorkerSessionAuthorizationInput,
  worker: WorkerSessionAuthorizationInput,
  currentUserId: string,
): boolean {
  const sourceOwned = (source.canManage ?? source.userId === currentUserId)
    && source.userId === currentUserId
  return sourceOwned
    && worker.id.startsWith('sess_worker_')
    && worker.machineId === source.machineId
    && worker.workDir === source.workDir
    && worker.userId === currentUserId
    && (worker.canManage ?? true)
}
