// @covers src/commands/guide.ts
// @covers src/commands/command-reference.ts
// @covers src/guides/catalog.ts
// @covers src/guides/collaboration.ts
// @covers src/guides/personal.ts
// @covers src/guides/local-apps.ts
// @covers src/guides/types.ts
import { Command } from 'commander'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { build, transform } from 'esbuild'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { registerCommandReference } from '../commands/command-reference.js'
import { featureGuides, FEATURE_GUIDE_INSTRUCTIONS, findFeatureGuide, searchFeatureGuides } from '../guides/catalog.js'

const originalExitCode = process.exitCode
afterEach(() => { process.exitCode = originalExitCode; vi.restoreAllMocks() })
async function run(args: string[]) {
  const program = new Command().name('shennian').exitOverride()
  registerCommandReference(program, 'candidate-test')
  const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  output.mockClear()
  await program.parseAsync(args, { from: 'user' })
  return output.mock.calls.map(call => String(call[0])).join('')
}

describe('bundled offline Client feature guides', () => {
  it('exposes guide through both root help and exact help without executing operations', async () => {
    expect(await run(['help'])).toContain('guide')
    expect(await run(['help', 'guide'])).toContain('--search <query>')
    expect(await run(['guide', '--json'])).toContain('documentationOnly')
  })
  it('lists all 14 unique topics with operation-vs-phone metadata and no full manual dump', async () => {
    const result = JSON.parse(await run(['guide', '--json']))
    expect(result).toMatchObject({ ok: true, documentationOnly: true, clientVersion: 'candidate-test' })
    expect(result.topics).toHaveLength(14)
    expect(new Set(result.topics.map((topic: { id: string }) => topic.id)).size).toBe(14)
    expect(result.topics[0]).not.toHaveProperty('body')
    expect(result.topics.find((topic: { id: string }) => topic.id === 'folders').execution).toBe('phone-guided')
    expect(result.topics.find((topic: { id: string }) => topic.id === 'local-apps').execution).toBe('client-command')
  })
  it('reads a full topic as text or JSON, tied to this Client version', async () => {
    const text = await run(['guide', 'local-apps'])
    expect(text).toContain('Shennian Client candidate-test')
    expect(text).toContain('127.0.0.1')
    const json = JSON.parse(await run(['guide', 'local-apps', '--json']))
    expect(json.guide).toEqual(findFeatureGuide('local-apps'))
    expect(json.guide.body).toContain('Codex、Claude Code')
  })
  it('searches only bundled topic metadata, never user directories', async () => {
    expect(searchFeatureGuides('通知').map(guide => guide.id)).toContain('reminders')
    expect(searchFeatureGuides('CLAUDE CODE').map(guide => guide.id)).toContain('local-apps')
    expect(searchFeatureGuides('  ')).toEqual([])
    const json = JSON.parse(await run(['guide', '--search', '完全不存在的主题', '--json']))
    expect(json).toMatchObject({ ok: true, topics: [] })
  })
  it('rejects unknown/file-like topics, ambiguous inputs and oversized searches without reading files', async () => {
    for (const [args, error] of [
      [['guide', '../../.env'], 'guide_unknown_topic'],
      [['guide', 'local-apps', '--search', 'app'], 'guide_topic_and_search_conflict'],
      [['guide', '--search', ' '], 'guide_search_invalid'],
      [['guide', '--search', 'x'.repeat(121)], 'guide_search_invalid'],
    ] as const) {
      const result = JSON.parse(await run([...args]))
      expect(result).toMatchObject({ ok: false, error, documentationOnly: true, nextAction: 'shennian guide' })
      expect(process.exitCode).toBe(1)
      process.exitCode = originalExitCode
    }
  })
  it('contains runnable app lifecycle guidance and documents the supported reminder commands', () => {
    const app = findFeatureGuide('local-apps')!.body
    for (const required of ['node server.mjs', "5173, '127.0.0.1'", 'local-apps register', '--id <精确app-id>',
      'local-apps inspect', 'local-apps doctor', 'window.shennian.personal.service', 'GET/POST/DELETE', '相对', 'WebSocket', '2 MiB', '登记成功当功能完成']) {
      expect(app, required).toContain(required)
    }
    expect(findFeatureGuide('reminders')!.body).toContain('shennian reminder --operation list/preview/create/update/complete/restore/delete')
    expect(findFeatureGuide('reminders')!.body).toContain('真实保存成功后确认')
    expect(findFeatureGuide('folders')!.body).toContain('没有公开 CLI')
    expect(findFeatureGuide('schedules')!.body).toContain('schedule_context_required/expired')
    expect(findFeatureGuide('schedules')!.body).toContain('管家运行时')
  })
  it('provides a syntactically valid minimal local HTTP example without starting it', async () => {
    const body = findFeatureGuide('local-apps')!.body
    const sample = body.slice(body.indexOf("    import { createServer }"), body.indexOf('\n\nindex.html'))
    expect((await transform(sample, { loader: 'js', format: 'esm', target: 'node22' })).code).toContain('.listen(')
  })
  it('injects discovery only, keeping documentation separate from data, authority and deployment status', () => {
    expect(FEATURE_GUIDE_INSTRUCTIONS).toContain('shennian guide local-apps')
    expect(FEATURE_GUIDE_INSTRUCTIONS).toContain('不把全部文档塞进上下文')
    expect(FEATURE_GUIDE_INSTRUCTIONS).toContain('不提供额外权限')
    expect(FEATURE_GUIDE_INSTRUCTIONS.length).toBeLessThan(600)
    for (const guide of featureGuides) {
      expect(guide.title.length).toBeGreaterThan(0)
      expect(guide.body.length).toBeGreaterThan(150)
    }
  })
  it('ships as compiled JS and works from an empty directory without repository Markdown or a daemon', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'feature-guide-artifact-'))
    try {
      const built = await build({
        stdin: { contents: "import { Command } from 'commander'; import { registerCommandReference } from './commands/command-reference.js'; const p = new Command().name('shennian'); registerCommandReference(p, 'artifact-candidate'); await p.parseAsync(['guide', 'local-apps', '--json'], {from:'user'});", resolveDir: path.resolve(__dirname, '..'), sourcefile: 'guide-smoke.ts', loader: 'ts' },
        bundle: true, format: 'esm', platform: 'node', target: 'node22', write: false, metafile: true,
        banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
      })
      const inputs = Object.keys(built.metafile!.inputs)
      expect(inputs.some(input => /config\/index|daemon-ipc|personal-agent|\.md$/.test(input))).toBe(false)
      const artifact = path.join(dir, 'guide.mjs')
      fs.writeFileSync(artifact, built.outputFiles[0].text)
      const result = JSON.parse(execFileSync(process.execPath, [artifact], { cwd: dir, encoding: 'utf8' }))
      expect(result).toMatchObject({ ok: true, clientVersion: 'artifact-candidate', documentationOnly: true })
      expect(result.guide.body).toContain('node server.mjs')
      expect(fs.readdirSync(dir)).toEqual(['guide.mjs'])
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })
})
