#!/usr/bin/env node
// @arch open-source/docs/cli-runtime.md
// @test scripts/__tests__/materialize-packed-dependencies.test.mjs
// npm pack does not bundle pnpm's transitive sibling symlinks. Materialize the
// already resolved graph without registry access or version resolution.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
export function materializeDependencies(root) {
  const modules = path.join(root, 'node_modules')
  const staged = path.join(root, '.packed-node-modules')
  if (fs.existsSync(staged)) throw new Error('packed staging directory already exists')
  const resolve = (from, name) => {
    for (let at = from; ; at = path.dirname(at)) {
      const candidate = path.join(at, 'node_modules', name)
      if (fs.existsSync(path.join(candidate, 'package.json'))) return fs.realpathSync(candidate)
      if (path.dirname(at) === at) throw new Error(`Missing locked dependency ${name}`)
    }
  }
  // Hoist each locked identity once when its name is free. Conflicting versions stay
  // nested; a package may only reuse the nearest matching ancestor or the root binding.
  const rootBindings = new Map()
  const copied = new Set()
  const copy = (source, target, ancestors) => {
    if (copied.has(target)) return
    copied.add(target)
    const pkg = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'))
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.cpSync(source, target, { recursive: true, filter: p => path.relative(source, p).split(path.sep)[0] !== 'node_modules' })
    // esbuild's local postinstall replaces its portable launcher with a host-native
    // executable. Shipping that optimized file breaks npm installation on Windows.
    if (pkg.name === 'esbuild') {
      const launcher = path.join(target, 'bin', 'esbuild')
      if (pkg.version === '0.28.1') fs.copyFileSync(new URL('./vendor/esbuild-0.28.1-bin.txt', import.meta.url), launcher)
      else if (!fs.readFileSync(launcher).subarray(0, 2).equals(Buffer.from('#!'))) throw new Error('esbuild_portable_launcher_required')
    }
    const next = new Map(ancestors); next.set(pkg.name, source)
    const placements = []
    for (const name of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) {
      let dependency
      try { dependency = resolve(source, name) } catch (error) { if (pkg.optionalDependencies?.[name]) continue; throw error }
      if ((next.get(name) ?? rootBindings.get(name)) === dependency) continue
      if (!rootBindings.has(name) && !next.has(name)) {
        rootBindings.set(name, dependency)
        placements.push([dependency, path.join(staged, name), null])
      } else {
        next.set(name, dependency)
        placements.push([dependency, path.join(target, 'node_modules', name), next])
      }
    }
    // Plan all sibling bindings before walking children: a nested sibling can shadow root.
    for (const [dependency, destination, inherited] of placements) copy(dependency, destination, inherited ?? new Map())
  }
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
    fs.mkdirSync(staged)
    for (const name of Object.keys(pkg.dependencies ?? {})) rootBindings.set(name, resolve(root, name))
    for (const [name, source] of rootBindings) copy(source, path.join(staged, name), new Map())
    fs.rmSync(modules, { recursive: true }); fs.renameSync(staged, modules)
  } catch (error) { fs.rmSync(staged, { recursive: true, force: true }); throw error }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) materializeDependencies(path.resolve(process.argv[2]))
