import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { minifyPublishJs } from './minify-publish-js.mjs'
import { stripDeclarationFiles } from './strip-publish-types.mjs'

/**
 * `pnpm deploy` copies @shennian/wire as plain tsc output. Minify it and drop its
 * declarations inside the packed artifact only; the workspace build still needs them.
 */
export async function hardenPackedWire(packageDir) {
  const wireDist = path.join(path.resolve(packageDir), 'node_modules', '@shennian', 'wire', 'dist')
  const minified = await minifyPublishJs({ distDir: wireDist, writeManifest: false })
  const removed = stripDeclarationFiles(wireDist)
  return { minified: minified.length, removed: removed.length }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const packageDir = process.argv[2]
  if (!packageDir) {
    console.error('usage: harden-packed-wire.mjs <packed-package-dir>')
    process.exit(2)
  }
  const result = await hardenPackedWire(packageDir)
  console.log(`packed wire: minified ${result.minified} js, removed ${result.removed} declaration files`)
}
