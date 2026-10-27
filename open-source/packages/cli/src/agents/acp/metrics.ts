// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/acp-discovery.test.ts

const metrics = {
  scans: 0,
  lastScanDurationMs: 0,
  lastCandidateCount: 0,
  lastInstalledCount: 0,
  cacheHits: 0,
  handshakeFailures: 0,
  handshakeFailuresByKind: {} as Record<string, number>,
  authFailures: 0,
  importSuccess: 0,
  importFailure: 0,
}

export function recordAcpScan(input: {
  durationMs: number
  candidateCount: number
  installedCount: number
  cacheHits: number
  handshakeFailures: number
  handshakeFailuresByKind: Record<string, number>
}): void {
  metrics.scans += 1
  metrics.lastScanDurationMs = Math.max(0, Math.round(input.durationMs))
  metrics.lastCandidateCount = input.candidateCount
  metrics.lastInstalledCount = input.installedCount
  metrics.cacheHits += input.cacheHits
  metrics.handshakeFailures += input.handshakeFailures
  for (const [kind, count] of Object.entries(input.handshakeFailuresByKind)) {
    metrics.handshakeFailuresByKind[kind] = (metrics.handshakeFailuresByKind[kind] ?? 0) + count
  }
}

export function recordAcpAuthFailure(): void { metrics.authFailures += 1 }
export function recordAcpImportResult(ok: boolean): void {
  if (ok) metrics.importSuccess += 1
  else metrics.importFailure += 1
}
export function getAcpLocalMetrics() {
  return { ...metrics, handshakeFailuresByKind: { ...metrics.handshakeFailuresByKind } }
}
