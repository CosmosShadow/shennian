// @arch docs/architecture/app/render-resilience.md
// @test src/__tests__/runtime-values.test.ts
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** A repeated query parameter is not an identifier. Reject ambiguity instead of joining it. */
export function routeString(value: unknown): string {
  return typeof value === 'string' ? value : Array.isArray(value) && value.length === 1 && typeof value[0] === 'string' ? value[0] : ''
}

/** Avoid Array.flatMap: some supported native JS runtimes do not provide it. */
export function collectMapped<T, R>(values: readonly T[], map: (value: T) => R[]): R[] {
  const result: R[] = []
  for (const value of values) result.push(...map(value))
  return result
}
