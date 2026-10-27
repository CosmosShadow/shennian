// @covers open-source/packages/cli/scripts/check-publish-artifact.mjs

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('CLI publish artifact gate', () => {
  it('accepts a product artifact without retired connector runtimes', async () => {
    const root = createFixture()
    const { checkPublishArtifact } = await loadChecker()

    expect(checkPublishArtifact({ cliRoot: root, distDir: path.join(root, 'dist') })).toEqual({
      ok: true,
      failures: [],
    })
  })

  it('rejects an artifact that accidentally restores a retired connector runtime', async () => {
    const root = createFixture()
    const retired = path.join(root, 'dist', 'src', 'channels', 'wechat-channel')
    fs.mkdirSync(retired, { recursive: true })
    fs.writeFileSync(path.join(retired, 'index.js'), 'export {}\n')
    const { checkPublishArtifact } = await loadChecker()

    expect(checkPublishArtifact({ cliRoot: root, distDir: path.join(root, 'dist') }))
      .toMatchObject({
        ok: false,
        failures: [expect.stringContaining('retired external connector runtime')],
      })
  })

  it('rejects an artifact missing an official Adapter detail document', async () => {
    const root = createFixture()
    fs.rmSync(path.join(root, 'dist', 'resources', 'agent-adapters', 'codex.md'))
    const { checkPublishArtifact } = await loadChecker()

    expect(checkPublishArtifact({ cliRoot: root, distDir: path.join(root, 'dist') }))
      .toMatchObject({
        ok: false,
        failures: [expect.stringContaining('resources/agent-adapters/codex.md')],
      })
  })

  it('rejects test output or source maps in the bundled Wire package', async () => {
    const root = createFixture()
    const wireDist = path.join(root, 'node_modules', '@shennian', 'wire', 'dist')
    fs.mkdirSync(path.join(wireDist, '__tests__'), { recursive: true })
    fs.writeFileSync(path.join(wireDist, '__tests__', 'types.test.js'), 'export {}\n')
    fs.writeFileSync(path.join(wireDist, 'index.js.map'), '{}\n')
    const { checkPublishArtifact } = await loadChecker()

    const result = checkPublishArtifact({ cliRoot: root, distDir: path.join(root, 'dist') })
    expect(result.ok).toBe(false)
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.stringContaining('bundled @shennian/wire contains test output'),
      expect.stringContaining('bundled @shennian/wire contains sourcemap file'),
    ]))
  })

  it('rejects declaration files, internal breadcrumbs and open-source metadata', async () => {
    const root = createFixture()
    fs.writeFileSync(path.join(root, 'dist', 'src', 'index.d.ts'), 'export {}\n')
    fs.writeFileSync(path.join(root, 'dist', 'src', 'leak.js'), '// @arch open-source/docs/cli-runtime.md {}\n')
    const packageJsonPath = path.join(root, 'package.json')
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
    packageJson.license = 'MIT'
    packageJson.repository = { type: 'git', url: 'https://github.com/example/public' }
    packageJson.types = './dist/src/index.d.ts'
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson))
    const { checkPublishArtifact } = await loadChecker()

    const result = checkPublishArtifact({ cliRoot: root, distDir: path.join(root, 'dist') })
    expect(result.ok).toBe(false)
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.stringContaining('declaration file: src/index.d.ts'),
      expect.stringContaining('internal breadcrumb comments: src/leak.js'),
      expect.stringContaining('must not declare a public repository'),
      expect.stringContaining('license must be UNLICENSED'),
      expect.stringContaining('must not point at declaration files'),
    ]))
  })

  it('requires the packed Wire copy to be free of declaration files', async () => {
    const root = createFixture()
    const wireDist = path.join(root, 'node_modules', '@shennian', 'wire', 'dist')
    fs.writeFileSync(path.join(wireDist, 'index.d.ts'), 'export {}\n')
    const { checkPublishArtifact } = await loadChecker()

    expect(checkPublishArtifact({ cliRoot: root, distDir: path.join(root, 'dist') }).ok).toBe(true)
    expect(checkPublishArtifact({ cliRoot: root, distDir: path.join(root, 'dist'), packed: true }))
      .toMatchObject({
        ok: false,
        failures: [expect.stringContaining('bundled @shennian/wire contains declaration file')],
      })
  })

  it('requires every production dependency in the self-contained bundle', async () => {
    const root = createFixture()
    const packageJsonPath = path.join(root, 'package.json')
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
    packageJson.dependencies.commander = '^13.1.0'
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson))
    const { checkPublishArtifact } = await loadChecker()

    expect(checkPublishArtifact({ cliRoot: root, distDir: path.join(root, 'dist') }))
      .toMatchObject({
        ok: false,
        failures: [expect.stringContaining('missing bundled dependency: commander')],
      })
  })
})

function createFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-publish-artifact-'))
  roots.push(root)
  const dist = path.join(root, 'dist')
  fs.mkdirSync(path.join(dist, 'src'), { recursive: true })
  fs.mkdirSync(path.join(dist, 'src', 'upgrade'), { recursive: true })
  const adapterDocs = path.join(dist, 'resources', 'agent-adapters')
  fs.mkdirSync(adapterDocs, { recursive: true })
  const wireDist = path.join(root, 'node_modules', '@shennian', 'wire', 'dist')
  fs.mkdirSync(wireDist, { recursive: true })
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    license: 'UNLICENSED',
    dependencies: { '@shennian/wire': 'workspace:*' },
    bundledDependencies: ['@shennian/wire'],
  }))
  fs.writeFileSync(path.join(dist, 'src', 'index.js'), 'export {}\n')
  fs.writeFileSync(
    path.join(dist, 'src', 'upgrade', 'updater-worker.js'),
    "import fs from 'node:fs'\nexport {}\n",
  )
  fs.writeFileSync(path.join(wireDist, 'index.js'), 'export {}\n')
  for (const id of ['claude', 'codex', 'cursor', 'workbuddy', 'opencode', 'pi-coding-agent', 'custom']) {
    fs.writeFileSync(path.join(adapterDocs, `${id}.md`), `# ${id}\n`)
  }
  fs.writeFileSync(path.join(dist, 'publish-build-manifest.json'), JSON.stringify({
    schemaVersion: 1,
    jsMinified: true,
    minifier: 'esbuild',
    fileCount: 1,
    files: ['src/index.js'],
  }))
  return root
}

async function loadChecker(): Promise<{
  checkPublishArtifact: (input: { cliRoot: string; distDir: string; packed?: boolean }) => {
    ok: boolean
    failures: string[]
  }
}> {
  // The release gate is intentionally an executable ESM script rather than TypeScript source.
  // @ts-expect-error The .mjs release script has no declaration file.
  return import('../../scripts/check-publish-artifact.mjs')
}
