// @arch docs/architecture/data-sync.md#16-可观测性与隐私验收
// @test src/__tests__/personal-session-history-metrics.test.ts

let revisionGaps = 0
const structuredErrors: Record<string, number> = {}

export function recordPersonalSessionRevisionGap(): void {
  revisionGaps += 1
}

export function recordPersonalSessionHistoryError(stage: string, code: string): void {
  const key = `${stage}:${code}`
  structuredErrors[key] = (structuredErrors[key] ?? 0) + 1
}

export function getPersonalSessionHistoryMetrics() {
  return {
    revisionGaps,
    structuredErrors: { ...structuredErrors },
    privacy: {
      containsAccountIdentity: false,
      containsSessionIdentity: false,
      containsMessageBody: false,
    },
  }
}

export function resetPersonalSessionHistoryMetricsForTests(): void {
  revisionGaps = 0
  for (const key of Object.keys(structuredErrors)) delete structuredErrors[key]
}
