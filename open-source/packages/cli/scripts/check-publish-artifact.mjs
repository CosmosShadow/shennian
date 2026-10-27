import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const cliRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const textExtensions = new Set([
  '.cjs',
  '.css',
  '.d.ts',
  '.html',
  '.js',
  '.json',
  '.mjs',
  '.md',
  '.txt',
])

const sourceMapMarkers = [
  { pattern: /sourceMappingURL=/, reason: 'sourceMappingURL marker' },
  { pattern: /sourcesContent/, reason: 'inline sourcesContent marker' },
  { pattern: /inlineSources/, reason: 'inlineSources marker' },
  { pattern: /application\/json[^,\n]+base64[^,\n]+sourceMappingURL/i, reason: 'inline source map data URL' },
]

const officialAdapterDocIds = ['claude', 'codex', 'cursor', 'workbuddy', 'opencode', 'pi-coding-agent', 'custom']

export function checkPublishArtifact(options = {}) {
  const root = options.cliRoot ? path.resolve(options.cliRoot) : cliRoot
  const distDir = options.distDir ? path.resolve(options.distDir) : path.join(root, 'dist')
  const failures = []

  if (!fs.existsSync(distDir)) {
    return { ok: false, failures: [`missing dist directory: ${distDir}`] }
  }

  checkRuntimeDependencyBundle({ root, failures })
  checkClosedSourcePackageMetadata({ root, failures })
  checkBundledWireArtifact({ root, failures, packed: options.packed === true })
  checkExternalUpdaterArtifact({ distDir, failures })
  checkOfficialAdapterDocs({ distDir, failures })

  const files = listFiles(distDir)
  const relativeFiles = files.map((file) => toPosix(path.relative(distDir, file)))

  for (const relative of relativeFiles) {
    if (relative.endsWith('.map')) failures.push(`publish artifact contains sourcemap file: ${relative}`)
    if (relative.includes('/__tests__/')) failures.push(`publish artifact contains test output: ${relative}`)
    if (relative.includes('/__experiments__/')) failures.push(`publish artifact contains experiment output: ${relative}`)
    if (/\.d\.(?:ts|mts|cts)$/.test(relative)) failures.push(`publish artifact contains declaration file: ${relative}`)
  }

  for (const file of files) {
    if (!isTextFile(file)) continue
    const relative = toPosix(path.relative(distDir, file))
    const source = fs.readFileSync(file, 'utf8')
    for (const { pattern, reason } of sourceMapMarkers) {
      if (pattern.test(source)) failures.push(`publish artifact contains ${reason}: ${relative}`)
    }
    if (/@arch\b|@covers\b/.test(source)) {
      failures.push(`publish artifact contains internal breadcrumb comments: ${relative}`)
    }
  }

  checkNoRetiredExternalConnectorArtifacts({ distDir, failures })
  checkNoNativeHelperArtifacts({ distDir, failures })
  checkNoRetiredRoomIntegrationArtifacts({ distDir, failures })

  const buildManifestPath = path.join(distDir, 'publish-build-manifest.json')
  if (!fs.existsSync(buildManifestPath)) {
    failures.push('publish artifact missing minify build manifest')
  } else {
    try {
      const manifest = JSON.parse(fs.readFileSync(buildManifestPath, 'utf8'))
      if (manifest?.schemaVersion !== 1 || manifest.jsMinified !== true || manifest.minifier !== 'esbuild') {
        failures.push('publish artifact minify build manifest is not marked as esbuild-minified')
      }
      if (!Number.isInteger(manifest.fileCount) || manifest.fileCount <= 0 || !Array.isArray(manifest.files)) {
        failures.push('publish artifact minify build manifest has no JS file records')
      }
    } catch (error) {
      failures.push(`publish artifact minify build manifest is invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return { ok: failures.length === 0, failures }
}

function checkOfficialAdapterDocs({ distDir, failures }) {
  const docsDir = path.join(distDir, 'resources', 'agent-adapters')
  for (const id of officialAdapterDocIds) {
    const docPath = path.join(docsDir, `${id}.md`)
    if (!fs.existsSync(docPath)) {
      failures.push(`publish artifact is missing official Adapter doc: resources/agent-adapters/${id}.md`)
    }
  }
}

function checkExternalUpdaterArtifact({ distDir, failures }) {
  const worker = path.join(distDir, 'src', 'upgrade', 'updater-worker.js')
  if (!fs.existsSync(worker)) {
    failures.push('publish artifact is missing the external updater worker')
    return
  }
  const source = fs.readFileSync(worker, 'utf8')
  if (/\bfrom\s+["']\.{1,2}\//.test(source) || /\brequire\(["']\.{1,2}\//.test(source)) {
    failures.push('external updater worker is not self-contained')
  }
  if (/dotenv|\.env(?:\W|$)/i.test(source)) {
    failures.push('external updater worker must not read dotenv or .env files')
  }
}

function checkRuntimeDependencyBundle({ root, failures }) {
  const packageJsonPath = path.join(root, 'package.json')
  if (!fs.existsSync(packageJsonPath)) {
    failures.push('publish artifact missing CLI package.json')
    return
  }
  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
    const bundled = packageJson.bundledDependencies ?? packageJson.bundleDependencies ?? []
    const dependencies = Object.keys(packageJson.dependencies ?? {})
    for (const dependency of dependencies) {
      if (!Array.isArray(bundled) || !bundled.includes(dependency)) {
        failures.push(`publish artifact missing bundled dependency: ${dependency}`)
      }
    }
  } catch (error) {
    failures.push(`CLI package.json is invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// The CLI is closed source: no public repository link and no open-source licence.
function checkClosedSourcePackageMetadata({ root, failures }) {
  const packageJsonPath = path.join(root, 'package.json')
  if (!fs.existsSync(packageJsonPath)) return
  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
    if (packageJson.repository) failures.push('CLI package.json must not declare a public repository')
    if (packageJson.license !== 'UNLICENSED') failures.push('CLI package.json license must be UNLICENSED')
    if (packageJson.types || packageJson.typings) failures.push('CLI package.json must not point at declaration files')
  } catch {
    // checkRuntimeDependencyBundle already reports invalid JSON.
  }
}

function checkBundledWireArtifact({ root, failures, packed }) {
  const wireDist = path.join(root, 'node_modules', '@shennian', 'wire', 'dist')
  if (!fs.existsSync(wireDist)) {
    failures.push('publish artifact is missing the built @shennian/wire bundle')
    return
  }
  for (const file of listFiles(wireDist)) {
    const relative = toPosix(path.relative(wireDist, file))
    if (relative.includes('__tests__/')) {
      failures.push(`bundled @shennian/wire contains test output: ${relative}`)
    }
    if (relative.endsWith('.map')) {
      failures.push(`bundled @shennian/wire contains sourcemap file: ${relative}`)
    }
    // The workspace copy keeps declarations for the CLI compile; only the packed copy is stripped.
    if (packed && /\.d\.(?:ts|mts|cts)$/.test(relative)) {
      failures.push(`bundled @shennian/wire contains declaration file: ${relative}`)
    }
  }
}

function checkNoNativeHelperArtifacts({ distDir, failures }) {
  const helperDir = path.join(distDir, 'assets', 'wechat-channel')
  if (fs.existsSync(helperDir)) {
    failures.push('publish artifact must not include native WeChat helper assets; install Shennian Desktop to provide them')
  }
}

function checkNoRetiredRoomIntegrationArtifacts({ distDir, failures }) {
  const retiredPaths = [
    'src/integrations/room-plugin-bundles.js',
    'src/integrations/room-plugin-shared.js',
    'src/integrations/room-session-hook.js',
    'src/integrations/workbuddy-session-hook.js',
    'src/room/invocation-token.js',
    'src/room/invocation-token-ipc.js',
    'src/room/room-action-ipc.js',
    'src/room/room-binding-ipc.js',
    'src/room/tool-schema.js',
    'src/room/tool-server.js',
  ]
  for (const relativePath of retiredPaths) {
    if (fs.existsSync(path.join(distDir, relativePath))) {
      failures.push(`publish artifact contains retired Room MCP/Hook runtime: ${relativePath}`)
    }
  }
}

function checkNoRetiredExternalConnectorArtifacts({ distDir, failures }) {
  const retiredPaths = [
    path.join(distDir, 'src', 'channels'),
    path.join(distDir, 'src', 'wechat-channel'),
    path.join(distDir, 'src', 'wecom'),
    path.join(distDir, 'src', 'feishu'),
  ]
  for (const retiredPath of retiredPaths) {
    if (fs.existsSync(retiredPath)) {
      failures.push(
        `publish artifact contains retired external connector runtime: ${toPosix(path.relative(distDir, retiredPath))}`,
      )
    }
  }
}

function listFiles(dir) {
  const files = []
  if (!fs.existsSync(dir)) return files
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...listFiles(fullPath))
    else if (entry.isFile()) files.push(fullPath)
  }
  return files
}

function isTextFile(file) {
  return textExtensions.has(path.extname(file))
}

function toPosix(value) {
  return value.split(path.sep).join('/')
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  // `--packed <dir>` checks the `pnpm deploy` output that is actually handed to `npm pack`.
  const packedIndex = process.argv.indexOf('--packed')
  const packedRoot = packedIndex >= 0 ? process.argv[packedIndex + 1] : undefined
  if (packedIndex >= 0 && !packedRoot) {
    console.error('publish artifact check failed: --packed requires a directory')
    process.exit(2)
  }
  const result = checkPublishArtifact(packedRoot ? { cliRoot: packedRoot, packed: true } : {})
  if (!result.ok) {
    for (const failure of result.failures) console.error(`publish artifact check failed: ${failure}`)
    process.exit(1)
  }
  console.log('publish artifact check passed')
}
