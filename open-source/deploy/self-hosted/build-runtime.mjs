import process from 'node:process'
import console from 'node:console'
// @arch open-source/docs/server-runtime.md
// @test scripts/__tests__/self-hosted-runtime.test.mjs
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { pathToFileURL } from 'node:url'
import YAML from 'yaml'

export function copySelfHostedPrisma(root, output) {
  const source = path.join(root, 'deploy/self-hosted/prisma')
  const schema = path.join(root, 'packages/server/prisma/schema.prisma')
  const target = JSON.parse(fs.readFileSync(path.join(source, 'baseline.json'), 'utf8'))
  const hash = crypto.createHash('sha256').update(fs.readFileSync(schema)).digest('hex')
  if (target.schemaVersion !== 1 || target.schemaSha256 !== hash) throw new Error('self_hosted_migration_chain_outdated')
  const destination = path.join(output, 'deploy/self-hosted/prisma')
  fs.cpSync(source, destination, { recursive: true, filter: file => {
    if (fs.lstatSync(file).isSymbolicLink()) throw new Error('symlink_in_runtime_input')
    return true
  } })
  const schemaOutput = path.join(output, 'packages/server/prisma/schema.prisma')
  fs.mkdirSync(path.dirname(schemaOutput), { recursive: true })
  fs.copyFileSync(schema, schemaOutput)
  fs.copyFileSync(path.join(root, 'packages/server/prisma.config.ts'), path.join(output, 'packages/server/prisma.config.ts'))
}

export function pruneRuntimeLock(lock, importers) {
  const keep = new Set()
  function visit(dependencies) {
    for (const [name, raw] of Object.entries(dependencies ?? {})) {
      const version = typeof raw === 'string' ? raw : raw.version
      if (version.startsWith('link:')) continue
      const key = `${name}@${version}`
      if (keep.has(key)) continue
      const snapshot = lock.snapshots[key]
      if (!snapshot) throw new Error(`missing_runtime_dependency: ${name}`)
      keep.add(key); visit(snapshot.dependencies); visit(snapshot.optionalDependencies)
    }
  }
  for (const importer of Object.values(importers)) visit(importer.dependencies)
  const metadata = new Set([...keep].map(key => key.split('(')[0]))
  return {
    lockfileVersion: lock.lockfileVersion, settings: lock.settings,
    importers,
    packages: Object.fromEntries(Object.entries(lock.packages).filter(([key]) => metadata.has(key))),
    snapshots: Object.fromEntries(Object.entries(lock.snapshots).filter(([key]) => keep.has(key))),
  }
}

export function buildSelfHostedRuntime({ root = process.cwd(), output }) {
  if (!output || fs.existsSync(output)) throw new Error('runtime_output_must_be_new_directory')
  const lock = YAML.parse(fs.readFileSync(path.join(root, 'pnpm-lock.yaml'), 'utf8'))
  const modules = JSON.parse(fs.readFileSync(path.join(root, 'packages/server/dist-core/build-modules.json'), 'utf8'))
  if (modules.variant !== 'core' || modules.modules.length) throw new Error('runtime_requires_core_build')
  fs.mkdirSync(output, { recursive: true, mode: 0o700 })
  const write = (file, value) => {
    fs.mkdirSync(path.dirname(path.join(output, file)), { recursive: true })
    fs.writeFileSync(path.join(output, file), `${JSON.stringify(value, null, 2)}\n`)
  }
  write('package.json', { name: 'shennian-self-hosted-runtime', private: true, packageManager: 'pnpm@9.15.4' })
  const importers = { '.': {} }
  const locations = ['packages/server', 'packages/wire', 'packages/cli', 'packages/server-extensions']
  for (const location of locations) {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, location, 'package.json'), 'utf8'))
    const dependencies = { ...pkg.dependencies }
    const lockedDependencies = { ...lock.importers[location].dependencies }
    if (location === 'packages/server') {
      dependencies.prisma = pkg.devDependencies.prisma
      lockedDependencies.prisma = lock.importers[location].devDependencies.prisma
    }
    write(`${location}/package.json`, { ...pkg, private: true, scripts: {}, devDependencies: {}, dependencies, publishConfig: undefined })
    importers[location] = { dependencies: lockedDependencies }
    fs.cpSync(path.join(root, location, location === 'packages/server' ? 'dist-core' : 'dist'), path.join(output, location, 'dist'), {
      recursive: true,
      filter: source => {
        if (fs.lstatSync(source).isSymbolicLink()) throw new Error('symlink_in_runtime_input')
        return !source.endsWith('.map') && !source.endsWith('.d.ts')
      },
    })
  }
  const forbidden = dependency => dependency.startsWith('private/') || dependency.includes('official-server')
  for (const importer of Object.values(importers)) {
    for (const [name, value] of Object.entries(importer.dependencies ?? {})) {
      if (forbidden(name) || forbidden(value.version)) throw new Error('private_runtime_dependency')
    }
  }
  copySelfHostedPrisma(root, output)
  fs.writeFileSync(path.join(output, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\nnodeLinker: hoisted\n")
  fs.writeFileSync(path.join(output, 'pnpm-lock.yaml'), YAML.stringify(pruneRuntimeLock(lock, importers)))
  const files = {}
  function hashDirectory(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) hashDirectory(file)
      else files[path.relative(output, file).replaceAll('\\', '/')] = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
    }
  }
  hashDirectory(output)
  write('runtime-manifest.json', { schemaVersion: 1, variant: 'self-hosted', modules: [], files })
  return { files: Object.keys(files).length }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  console.log(JSON.stringify(buildSelfHostedRuntime({ output: process.argv[2] })))
}
