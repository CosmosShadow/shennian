import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as esbuild from 'esbuild'

const cliRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const distDir = path.join(cliRoot, 'dist')
const textEncoder = new TextEncoder()

export async function minifyPublishJs(options = {}) {
  const root = options.distDir ? path.resolve(options.distDir) : distDir
  const files = listFiles(root).filter((file) => file.endsWith('.js') || file.endsWith('.mjs'))
  const minified = []
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8')
    const shebang = source.startsWith('#!')
      ? `${source.slice(0, source.indexOf('\n') >= 0 ? source.indexOf('\n') : source.length)}\n`
      : ''
    const code = shebang ? source.slice(shebang.length) : source
    const result = await esbuild.transform(code, {
      format: 'esm',
      loader: 'js',
      minify: true,
      legalComments: 'none',
      sourcemap: false,
      target: 'node18',
    })
    const output = `${shebang}${result.code.trimEnd()}\n`
    fs.writeFileSync(file, output)
    minified.push({
      file: toPosix(path.relative(root, file)),
      beforeBytes: textEncoder.encode(source).length,
      afterBytes: textEncoder.encode(output).length,
    })
  }
  if (options.writeManifest !== false) {
    fs.writeFileSync(path.join(root, 'publish-build-manifest.json'), `${JSON.stringify({
      schemaVersion: 1,
      jsMinified: true,
      minifier: 'esbuild',
      fileCount: minified.length,
      files: minified,
    }, null, 2)}\n`)
  }
  return minified
}

function listFiles(dir) {
  const files = []
  if (!fs.existsSync(dir)) return files
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...listFiles(fullPath))
    else if (entry.isFile()) files.push(fullPath)
  }
  return files
}

function toPosix(value) {
  return value.split(path.sep).join('/')
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const result = await minifyPublishJs()
  console.log(`minified ${result.length} CLI publish JS files`)
}
