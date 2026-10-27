import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/** Remove declaration files so the npm package does not ship typed internals and JSDoc. */
export function stripDeclarationFiles(dir) {
  const removed = []
  const walk = (current) => {
    if (!fs.existsSync(current)) return
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile() && /\.d\.(?:ts|mts|cts)(?:\.map)?$/.test(entry.name)) {
        fs.rmSync(full)
        removed.push(full)
      }
    }
  }
  walk(path.resolve(dir))
  return removed
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const dirs = process.argv.slice(2)
  if (!dirs.length) {
    console.error('usage: strip-publish-types.mjs <dir>...')
    process.exit(2)
  }
  const removed = dirs.flatMap(stripDeclarationFiles)
  console.log(`removed ${removed.length} declaration files`)
}
