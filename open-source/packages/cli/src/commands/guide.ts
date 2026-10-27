// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/feature-guides.test.ts
import type { Command } from 'commander'
import { featureGuides, findFeatureGuide, searchFeatureGuides } from '../guides/catalog.js'

export function registerGuideCommand(program: Command, clientVersion: string): void {
  program.command('guide [topic]')
    .description('Read bundled offline feature guides for humans and AI; no account or daemon required')
    .option('--search <query>', 'Find topics by title, summary or keywords (up to 120 characters)')
    .option('--json', 'Return structured documentation, not live account state')
    .action((topic: string | undefined, flags: { search?: string; json?: boolean }) => {
      const metadata = { schemaVersion: 1, clientVersion, documentationOnly: true }
      const fail = (error: string) => {
        process.stdout.write(`${JSON.stringify({ ...metadata, ok: false, error, nextAction: 'shennian guide' })}\n`)
        process.exitCode = 1
      }
      if (topic && flags.search !== undefined) { fail('guide_topic_and_search_conflict'); return }
      if (flags.search !== undefined && (!flags.search.trim() || flags.search.length > 120)) { fail('guide_search_invalid'); return }
      if (topic) {
        const guide = findFeatureGuide(topic)
        if (!guide) { fail('guide_unknown_topic'); return }
        process.stdout.write(flags.json
          ? `${JSON.stringify({ ...metadata, ok: true, guide })}\n`
          : `Shennian Client ${clientVersion} · bundled documentation\n\n${guide.body}\n`)
        return
      }
      const topics = (flags.search !== undefined ? searchFeatureGuides(flags.search) : featureGuides)
        .map(({ id, title, summary, execution }) => ({ id, title, summary, execution }))
      process.stdout.write(flags.json
        ? `${JSON.stringify({ ...metadata, ok: true, topics })}\n`
        : `Shennian Client ${clientVersion} · 功能指南（离线文档，不代表操作授权或实时可用性）\n\n${topics.map(row => `${row.id} [${row.execution}] — ${row.title}\n  ${row.summary}`).join('\n')}\n\n读取：shennian guide <topic>\n搜索：shennian guide --search <关键词>\n参数：shennian help <命令>\n`)
    })
}
