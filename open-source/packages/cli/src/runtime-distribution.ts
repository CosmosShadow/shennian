// @arch open-source/docs/cli-runtime.md
// @test open-source/packages/cli/src/__tests__/runtime-distribution.test.ts

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export type CliDistribution = {
  source: 'global-cli'
  cliVersion: string
  updateOwner: 'cli'
}

/** Read our own package, not argv, PATH, daemon state or inherited Agent env. */
export function readCliDistribution(startFile = fileURLToPath(import.meta.url)): CliDistribution {
  let directory = path.dirname(startFile)
  for (let depth = 0; depth < 7; depth++) {
    const manifest = path.join(directory, 'package.json')
    if (fs.existsSync(manifest)) {
      const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8')) as {
        name?: string
        version?: string
      }
      if (pkg.name === 'shennian') {
        return {
          source: 'global-cli',
          cliVersion: pkg.version ?? 'unknown',
          updateOwner: 'cli',
        }
      }
    }
    const parent = path.dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  throw new Error('Cannot identify the Shennian CLI installation.')
}
