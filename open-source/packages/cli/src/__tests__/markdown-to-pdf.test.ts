// @covers src/tools/markdown-to-pdf.ts

import { describe, expect, it } from 'vitest'
import {
  defaultPdfOutputPath,
  findChromiumExecutable,
  MarkdownPdfBrowserMissingError,
  markdownPdfSetupRequiredPayload,
  MARKDOWN_PDF_SETUP_REQUIRED_CODE,
  renderMarkdownBody,
  renderMarkdownHtml,
} from '../tools/markdown-to-pdf.js'

describe('markdown to pdf tool', () => {
  it('keeps the source basename and swaps extension for default PDF output', () => {
    expect(defaultPdfOutputPath('/Users/demo/report.md')).toBe('/Users/demo/report.pdf')
    expect(defaultPdfOutputPath('/Users/demo/report.mdx')).toBe('/Users/demo/report.pdf')
    expect(defaultPdfOutputPath('C:\\Users\\demo\\report.md')).toBe('C:\\Users\\demo\\report.pdf')
  })

  it('renders core Markdown structures into printable HTML', () => {
    const html = renderMarkdownBody(
      [
        '# Report',
        '',
        'Hello **world** with `code`.',
        '',
        '- item',
        '',
        '| A | B |',
        '| --- | --- |',
        '| 1 | 2 |',
      ].join('\n'),
      '/tmp',
    )

    expect(html).toContain('<h1 id="report">Report</h1>')
    expect(html).toContain('<strong>world</strong>')
    expect(html).toContain('<ul><li>item</li></ul>')
    expect(html).toContain('<table>')
  })

  it('wraps content in a self-contained print document', () => {
    const html = renderMarkdownHtml('# 标题', { title: '报告' })

    expect(html).toContain('<title>报告</title>')
    expect(html).toContain('@page { size: A4; margin: 18mm 16mm; }')
    expect(html).toContain('PingFang SC')
  })

  it('maps missing browsers to structured setup metadata', async () => {
    await expect(findChromiumExecutable('/definitely/missing/chromium')).rejects.toBeInstanceOf(
      MarkdownPdfBrowserMissingError,
    )
    expect(markdownPdfSetupRequiredPayload()).toMatchObject({
      code: MARKDOWN_PDF_SETUP_REQUIRED_CODE,
      skillId: 'markdown-to-pdf',
      doctorId: 'markdownPdf.browser',
      recommendedRepairActionId: 'markdownPdf.installManagedChromium',
    })
  })
})
