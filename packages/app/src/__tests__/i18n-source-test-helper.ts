import { readFileSync, readdirSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'

/**
 * Legacy source-structure suites still inspect translation source text. Keep them
 * compatible with the generated-by-hand language partitions until they migrate
 * to assertions against the exported translation objects.
 */
export function readI18nSource(relativePath: string): string {
  const entry = resolve(__dirname, relativePath)
  const directory = dirname(entry)
  const stem = basename(entry, '.ts')
  const prefix = stem === 'en' || stem === 'zh' ? `${stem}-` : `${stem}-part-`
  const parts = readdirSync(directory)
    .filter((name) => name.startsWith(prefix) && name.endsWith('.ts'))
    .sort()
  return [
    readFileSync(entry, 'utf8'),
    ...parts.map((name) => readFileSync(resolve(directory, name), 'utf8')),
  ].join('\n')
}
