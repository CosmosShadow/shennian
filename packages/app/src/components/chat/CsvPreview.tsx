// @arch docs/architecture/app/chat-attachments-preview.md
// @test packages/app/src/__tests__/csv-preview.test.ts

import { useMemo, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import type { Colors } from '../../hooks/useTheme'
import { parseCsvPreview } from './parseCsvPreview'

export function CsvPreview({
  content,
  colors,
  isDark,
}: {
  content: string | null
  colors: Colors
  isDark: boolean
}) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<'table' | 'raw'>('table')
  const preview = useMemo(() => parseCsvPreview(content ?? ''), [content])

  if (content == null) return null

  if (mode === 'raw') {
    return (
      <RawCsvPreview
        content={content}
        colors={colors}
        isDark={isDark}
        toggleLabel={t('csv_preview_table')}
        onToggle={() => setMode('table')}
      />
    )
  }

  const [header = [], ...bodyRows] = preview.rows
  const columnCount = Math.max(header.length, ...bodyRows.map((row) => row.length), 1)
  const columns = Array.from({ length: columnCount }, (_value, index) => index)
  const borderColor = isDark ? '#30363d' : '#d0d7de'
  const headerBg = isDark ? '#161b22' : colors.surface
  const cellBg = isDark ? '#0d1117' : '#fff'
  const rowNumberBg = isDark ? '#111827' : '#f6f8fa'

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: colors.bg }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          padding: '4px 8px',
          borderBottom: `1px solid ${colors.border}`,
          background: colors.surface,
        }}
      >
        <span style={{ fontSize: 11, color: colors.textTertiary, fontWeight: 600, textTransform: 'uppercase' }}>
          CSV
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {(preview.truncatedRows || preview.truncatedColumns) && (
            <span style={{ fontSize: 11, color: colors.textTertiary }}>
              {t('csv_preview_truncated', { rows: preview.maxRows, columns: preview.maxColumns })}
            </span>
          )}
          <button
            onClick={() => setMode('raw')}
            style={{
              fontSize: 11,
              color: colors.brand,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '2px 6px',
            }}
          >
            {t('csv_preview_raw')}
          </button>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', background: cellBg }}>
        <table
          style={{
            borderCollapse: 'separate',
            borderSpacing: 0,
            minWidth: '100%',
            width: 'max-content',
            fontFamily: "'SF Mono','Menlo','Consolas',monospace",
            fontSize: 12,
            lineHeight: '18px',
            color: colors.text,
          }}
        >
          <thead>
            <tr>
              <th style={csvHeaderCellStyle(headerBg, borderColor, colors.textTertiary, true)}>#</th>
              {columns.map((index) => {
                const cell = header[index] ?? ''
                return (
                  <th key={`h-${index}`} style={csvHeaderCellStyle(headerBg, borderColor, colors.text)}>
                    {cell || `Column ${index + 1}`}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {bodyRows.map((row, rowIndex) => (
              <tr key={`r-${rowIndex}`}>
                <td style={csvBodyCellStyle(rowNumberBg, borderColor, colors.textTertiary, true)}>
                  {rowIndex + 1}
                </td>
                {columns.map((columnIndex) => (
                  <td key={`c-${rowIndex}-${columnIndex}`} style={csvBodyCellStyle(cellBg, borderColor, colors.text)}>
                    {row[columnIndex] ?? ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}


function RawCsvPreview({
  content,
  colors,
  isDark,
  toggleLabel,
  onToggle,
}: {
  content: string
  colors: Colors
  isDark: boolean
  toggleLabel: string
  onToggle: () => void
}) {
  const bgColor = isDark ? '#0d1117' : '#fff'
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: colors.bg }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '4px 8px',
          borderBottom: `1px solid ${colors.border}`,
          background: colors.surface,
        }}
      >
        <span style={{ fontSize: 11, color: colors.textTertiary, fontWeight: 600, textTransform: 'uppercase' }}>
          CSV
        </span>
        <button
          onClick={onToggle}
          style={{ fontSize: 11, color: colors.brand, background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }}
        >
          {toggleLabel}
        </button>
      </div>
      <pre
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          margin: 0,
          padding: 12,
          background: bgColor,
          color: colors.text,
          fontFamily: "'SF Mono','Menlo','Consolas',monospace",
          fontSize: 12,
          lineHeight: '18px',
          whiteSpace: 'pre',
        }}
      >
        {content}
      </pre>
    </div>
  )
}

function csvHeaderCellStyle(
  background: string,
  borderColor: string,
  color: string,
  isRowNumber = false,
): CSSProperties {
  return {
    position: 'sticky',
    top: 0,
    left: isRowNumber ? 0 : undefined,
    zIndex: isRowNumber ? 3 : 2,
    background,
    color,
    borderRight: `1px solid ${borderColor}`,
    borderBottom: `1px solid ${borderColor}`,
    padding: '6px 10px',
    minWidth: isRowNumber ? 48 : 120,
    maxWidth: 360,
    textAlign: isRowNumber ? 'right' : 'left',
    fontWeight: 700,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  }
}

function csvBodyCellStyle(
  background: string,
  borderColor: string,
  color: string,
  isRowNumber = false,
): CSSProperties {
  return {
    position: isRowNumber ? 'sticky' : undefined,
    left: isRowNumber ? 0 : undefined,
    zIndex: isRowNumber ? 1 : undefined,
    background,
    color,
    borderRight: `1px solid ${borderColor}`,
    borderBottom: `1px solid ${borderColor}`,
    padding: '5px 10px',
    minWidth: isRowNumber ? 48 : 120,
    maxWidth: 360,
    textAlign: isRowNumber ? 'right' : 'left',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  }
}
