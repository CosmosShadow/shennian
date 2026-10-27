// @arch open-source/docs/system-architecture.md
// @test open-source/deploy/self-hosted/verify-runtime.test.mjs
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import process from 'node:process'
import { log } from 'node:console'
import { pathToFileURL } from 'node:url'

/** Check the pristine pack before installing any third-party dependencies. */
export function verifyRuntime(directory) {
  const root = path.resolve(directory)
  const manifestFile = path.join(root, 'runtime-manifest.json')
  if (!fs.lstatSync(root).isDirectory() || !fs.lstatSync(manifestFile).isFile()) throw new Error('runtime_regular_files_only')
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
  if (manifest.schemaVersion !== 1 || manifest.variant !== 'self-hosted' ||
      !Array.isArray(manifest.modules) || manifest.modules.length ||
      !manifest.files || Array.isArray(manifest.files) || !Object.keys(manifest.files).length) {
    throw new Error('invalid_core_runtime_manifest')
  }
  const expected = new Set(Object.keys(manifest.files))
  for (const file of expected) {
    if (file.includes('\\') || path.isAbsolute(file) || file.split('/').some(part =>
      !part || part === '.' || part === '..' || part === 'private' || part === 'internal-docs' ||
      part.startsWith('.env') || part.endsWith('.env'))) throw new Error('forbidden_runtime_path')
    if (!/^[a-f0-9]{64}$/.test(manifest.files[file])) throw new Error('invalid_runtime_hash')
  }
  let count = 0
  function visit(directoryPath) {
    for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
      const target = path.join(directoryPath, entry.name)
      const relative = path.relative(root, target).split(path.sep).join('/')
      if (entry.isSymbolicLink()) throw new Error('runtime_symlink_not_allowed')
      if (entry.isDirectory()) { visit(target); continue }
      if (!entry.isFile()) throw new Error('runtime_regular_files_only')
      if (relative === 'runtime-manifest.json') continue
      if (!expected.has(relative)) throw new Error('unmanifested_runtime_file')
      const actual = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex')
      if (actual !== manifest.files[relative]) throw new Error('runtime_hash_mismatch')
      count++
    }
  }
  visit(root)
  if (count !== expected.size) throw new Error('runtime_file_missing')
  return { variant: manifest.variant, files: count }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  log(JSON.stringify(verifyRuntime(process.argv[2])))
}
