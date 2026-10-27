// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/npm-command.test.ts

import fs from 'node:fs'
import path from 'node:path'
import { getShennianDir } from '../config/index.js'

/**
 * The installer can place a private Node under `<shennian home>/runtime/node` for people
 * without a usable Node. Services started from it do not have that directory on PATH,
 * so npm is taken from beside the running Node: on macOS/Linux through the installer's
 * `bin/shennian-npm` wrapper (it puts its own Node first on PATH for npm's
 * `#!/usr/bin/env node` launcher), on Windows through `npm.cmd`, which already uses the
 * adjacent node.exe. Any other Node keeps the historical `npm` / `npm.cmd` lookup.
 */
export function privateNodeRoot(): string {
  return path.join(getShennianDir(), 'runtime', 'node')
}

export function isPrivateNode(nodeExecutable: string, root = privateNodeRoot()): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(nodeExecutable))
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

export function resolveNpmCommand(
  nodeExecutable = process.execPath,
  platform: NodeJS.Platform = process.platform,
  root = privateNodeRoot(),
): string {
  const fallback = platform === 'win32' ? 'npm.cmd' : 'npm'
  if (!isPrivateNode(nodeExecutable, root)) return fallback
  const candidate = path.join(path.dirname(nodeExecutable), platform === 'win32' ? 'npm.cmd' : 'shennian-npm')
  if (!fs.existsSync(candidate)) return fallback
  // Windows runs npm.cmd through the shell; profile paths may contain spaces.
  return platform === 'win32' ? `"${candidate}"` : candidate
}
