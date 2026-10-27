// @arch docs/architecture/app/chat-attachments-preview.md
// @covers packages/app/src/components/chat/parseCsvPreview.ts

import { describe, expect, it } from 'vitest'
import { parseCsvPreview } from '../components/chat/parseCsvPreview'

describe('csv preview parsing', () => {
  it('parses quoted CSV values and CRLF rows', () => {
    const preview = parseCsvPreview('name,note\r\nAlice,"hello, world"\r\nBob,"multi\nline"')

    expect(preview.rows).toEqual([
      ['name', 'note'],
      ['Alice', 'hello, world'],
      ['Bob', 'multi\nline'],
    ])
    expect(preview.truncatedRows).toBe(false)
    expect(preview.truncatedColumns).toBe(false)
  })

  it('limits rendered rows and columns for large CSV files', () => {
    const preview = parseCsvPreview('a,b,c,d\n1,2,3,4\n5,6,7,8', { maxRows: 2, maxColumns: 2 })

    expect(preview.rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
    expect(preview.truncatedRows).toBe(true)
    expect(preview.truncatedColumns).toBe(true)
  })
})
