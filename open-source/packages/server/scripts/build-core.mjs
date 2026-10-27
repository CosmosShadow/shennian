// @arch open-source/docs/server-runtime.md
// @test open-source/deploy/self-hosted/core-boundary.test.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { checkCoreBoundary } from './check-core-boundary.mjs'

const require = createRequire(import.meta.url)
const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
function compile(config, root) {
  execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', config], { cwd: root, stdio: 'inherit' })
}

export function buildCore({ root = serverRoot, runCompiler = compile } = {}) {
  const configPath = path.join(root, 'tsconfig.core.json')
  const boundary = checkCoreBoundary({ configPath, forbiddenDirectories: [path.join(root, 'src/official'), path.resolve(root, '../../private'), path.resolve(root, '../../../private')] })
  // Dedicated output: never overwrite the official build or a source manifest.
  const output = path.join(root, 'dist-core')
  fs.rmSync(output, { recursive: true, force: true })
  fs.rmSync(path.join(root, '.tsbuildinfo.core'), { force: true })
  runCompiler(configPath, root)
  if (fs.existsSync(path.join(output, 'official')) || fs.existsSync(path.join(output, 'server.js'))) {
    throw new Error('official_code_in_core_output')
  }
  fs.cpSync(path.join(root, 'src/schemas'), path.join(output, 'schemas'), { recursive: true })
  fs.writeFileSync(path.join(output, 'build-modules.json'), `${JSON.stringify({ schemaVersion: 1, variant: 'core', modules: [] })}\n`)
  return boundary
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  console.log(JSON.stringify({ boundary: 'server-core', ...buildCore() }))
  console.log('Core build complete: no official module source included.')
}
