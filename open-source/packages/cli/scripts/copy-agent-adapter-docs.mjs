#!/usr/bin/env node
// Bundles the official Adapter detail Markdown (open-source/docs/agent-adapters/)
// into dist/resources so `adapter show <id>` can read it after a real npm
// install, without shipping the whole docs/ tree. See
// open-source/docs/agent-adapters/README.md for the authoring convention.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Kept in sync with OFFICIAL_ADAPTERS in ../src/adapter-kit/official-adapters.ts.
// Duplicated as a plain list (rather than imported) so this script can run
// before the TypeScript build produces dist/, with no load-order coupling.
const OFFICIAL_ADAPTER_IDS = ['claude', 'codex', 'cursor', 'workbuddy', 'opencode', 'pi-coding-agent', 'custom']

const cliRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const repoRoot = path.resolve(cliRoot, '..', '..')
const sourceDir = path.join(repoRoot, 'docs', 'agent-adapters')
const targetDir = path.join(cliRoot, 'dist', 'resources', 'agent-adapters')

fs.mkdirSync(targetDir, { recursive: true })

let copied = 0
for (const id of OFFICIAL_ADAPTER_IDS) {
  const source = path.join(sourceDir, `${id}.md`)
  if (!fs.existsSync(source)) {
    process.stderr.write(`Missing official Adapter doc: ${source}\n`)
    process.exitCode = 1
    continue
  }
  fs.copyFileSync(source, path.join(targetDir, `${id}.md`))
  copied += 1
}

process.stdout.write(`Copied ${copied} official Adapter doc(s) into dist/resources/agent-adapters.\n`)
