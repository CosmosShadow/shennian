// @covers open-source/packages/server/src/lib/database-url.ts

import { describe, expect, it } from 'vitest'
import { withDatabaseConnectionLimit } from '../lib/database-url.js'

describe('database connection budget', () => {
  it('adds or replaces the MariaDB pool limit without changing credentials', () => {
    const source = 'mysql://user:secret@example.test/shennian?ssl=true&connectionLimit=20'
    const result = new URL(withDatabaseConnectionLimit(source, '6'))

    expect(result.username).toBe('user')
    expect(result.password).toBe('secret')
    expect(result.searchParams.get('ssl')).toBe('true')
    expect(result.searchParams.get('connectionLimit')).toBe('6')
  })

  it('leaves local development unchanged when no budget is configured', () => {
    const source = 'mysql://localhost/shennian'
    expect(withDatabaseConnectionLimit(source)).toBe(source)
  })

  it('rejects unsafe pool limits', () => {
    expect(() => withDatabaseConnectionLimit('mysql://localhost/shennian', '0')).toThrow()
    expect(() => withDatabaseConnectionLimit('mysql://localhost/shennian', 'many')).toThrow()
  })
})
