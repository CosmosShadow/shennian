// @arch docs/architecture/app/chat-attachments-preview.md
// @test packages/app/src/__tests__/csv-preview.test.ts

export const CSV_PREVIEW_MAX_ROWS = 500
export const CSV_PREVIEW_MAX_COLUMNS = 50

export type CsvPreviewCell = string

export type CsvPreviewResult = {
  rows: CsvPreviewCell[][]
  truncatedRows: boolean
  truncatedColumns: boolean
  maxRows: number
  maxColumns: number
}

export function parseCsvPreview(
  source: string,
  options: { maxRows?: number; maxColumns?: number } = {},
): CsvPreviewResult {
  const maxRows = Math.max(1, options.maxRows ?? CSV_PREVIEW_MAX_ROWS)
  const maxColumns = Math.max(1, options.maxColumns ?? CSV_PREVIEW_MAX_COLUMNS)
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false
  let truncatedColumns = false
  let truncatedRows = false
  let stopped = false

  const pushCell = () => {
    if (row.length < maxColumns) {
      row.push(cell)
    } else {
      truncatedColumns = true
    }
    cell = ''
  }

  const pushRow = () => {
    pushCell()
    if (rows.length < maxRows) {
      rows.push(row)
    } else {
      truncatedRows = true
      stopped = true
    }
    row = []
  }

  for (let index = 0; index < source.length; index += 1) {
    if (stopped) break
    const char = source[index]
    const next = source[index + 1]

    if (inQuotes) {
      if (char === '"' && next === '"') {
        cell += '"'
        index += 1
      } else if (char === '"') {
        inQuotes = false
      } else {
        cell += char
      }
      continue
    }

    if (char === '"') {
      inQuotes = true
      continue
    }

    if (char === ',') {
      pushCell()
      continue
    }

    if (char === '\n') {
      pushRow()
      continue
    }

    if (char === '\r') {
      if (next === '\n') index += 1
      pushRow()
      continue
    }

    cell += char
  }

  if (!stopped && (cell.length > 0 || row.length > 0 || source.length === 0)) {
    pushRow()
  }

  return { rows, truncatedRows, truncatedColumns, maxRows, maxColumns }
}
