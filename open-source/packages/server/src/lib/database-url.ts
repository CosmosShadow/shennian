// @arch open-source/docs/server-runtime.md
// @test src/__tests__/database-url.test.ts

export function withDatabaseConnectionLimit(databaseUrl: string, rawLimit?: string): string {
  if (!rawLimit) return databaseUrl

  const limit = Number(rawLimit)
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('SHENNIAN_DB_CONNECTION_LIMIT must be an integer between 1 and 100')
  }

  const parsed = new URL(databaseUrl)
  parsed.searchParams.set('connectionLimit', String(limit))
  return parsed.toString()
}
