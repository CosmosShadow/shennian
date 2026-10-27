// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/markdown-to-pdf.test.ts

import type { Command } from 'commander'
import chalk from 'chalk'
import { convertMarkdownToPdf, defaultPdfOutputPath } from '../tools/markdown-to-pdf.js'

export function registerToolsCommand(program: Command): void {
  const tools = program.command('tools').description('Local deterministic Shennian tools')

  tools
    .command('markdown-to-pdf')
    .alias('md-to-pdf')
    .description('Convert a local Markdown file to PDF on this machine')
    .argument('<input>', 'Markdown file path (.md or .mdx)')
    .option('-o, --output <path>', 'PDF output path; defaults to the same folder and basename')
    .option('--title <title>', 'PDF document title')
    .option('--keep-html', 'Keep the intermediate HTML file next to the PDF')
    .option('--chrome <path>', 'Chrome/Edge/Chromium executable path')
    .action(async (input: string, opts: {
      output?: string
      title?: string
      keepHtml?: boolean
      chrome?: string
    }) => {
      try {
        const outputPath = opts.output || defaultPdfOutputPath(input)
        const result = await convertMarkdownToPdf(input, {
          outputPath,
          title: opts.title,
          keepHtml: opts.keepHtml,
          chromePath: opts.chrome,
        })
        console.log(chalk.green('✓ PDF exported'))
        console.log(result.outputPath)
      } catch (error) {
        console.error(chalk.red('✗ Markdown to PDF failed'))
        console.error(error instanceof Error ? error.message : String(error))
        process.exit(1)
      }
    })
}
