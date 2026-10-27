// @arch docs/features/network-rooms/mobile-control-and-single-room-web.md
// @test scripts/__tests__/web-retirement-audit.test.mjs

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export const FINAL_ROUTE_PATTERNS = [
  /^\/$/,
  /^\/\+not-found$/,
  /^\/_sitemap$/,
  /^\/landing$/,
  /^\/privacy$/,
  /^\/support$/,
  /^\/docs$/,
  /^\/desktop$/,
  /^\/authorize\/\[intentId\]$/,
  /^\/machine-invites\/\[token\]$/,
  /^\/contacts\/users\/\[userId\]$/,
  /^\/p\/\[publicId\]$/,
  /^\/publish$/,
  /^\/spaces\/\[roomId\]$/,
  /^\/(?:share|embed)\/\[token\]$/,
]

export const FORBIDDEN_BUNDLE_MARKERS = [
  'agentPrivateConfigs',
  'sessionDeletions',
  'roomJoinRequests',
  '[accountId+roomId+sequenceKey]',
  'SyncEngine',
  'Dexie',
  'web_control_retired_title',
]

function listFiles(root) {
  const files = []
  const visit = (directory) => {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name)
      if (statSync(path).isDirectory()) visit(path)
      else files.push(path)
    }
  }
  visit(root)
  return files
}

export function htmlFileToRoute(distDir, file) {
  const normalized = relative(distDir, file).split(sep).join('/')
  if (!normalized.endsWith('.html')) return null
  const withoutExtension = normalized.slice(0, -'.html'.length)
  if (withoutExtension === 'index') return '/'
  if (withoutExtension.endsWith('/index')) {
    return `/${withoutExtension.slice(0, -'/index'.length)}`
  }
  return `/${withoutExtension}`
}

export function auditWebRetirement(distDir) {
  const absoluteDist = resolve(distDir)
  if (!existsSync(join(absoluteDist, 'index.html'))) {
    throw new Error(`Web export is missing index.html: ${absoluteDist}`)
  }

  const files = listFiles(absoluteDist)
  const routes = files
    .map((file) => htmlFileToRoute(absoluteDist, file))
    .filter(Boolean)
    .sort()
  const unexpectedRoutes = routes.filter(
    (route) => !FINAL_ROUTE_PATTERNS.some((pattern) => pattern.test(route)),
  )
  const jsFiles = files.filter((file) => file.endsWith('.js'))
  const jsBytes = jsFiles.reduce((total, file) => total + statSync(file).size, 0)
  const markerCounts = Object.fromEntries(FORBIDDEN_BUNDLE_MARKERS.map((marker) => [marker, 0]))

  for (const file of jsFiles) {
    const source = readFileSync(file, 'utf8')
    for (const marker of FORBIDDEN_BUNDLE_MARKERS) {
      let offset = 0
      while ((offset = source.indexOf(marker, offset)) !== -1) {
        markerCounts[marker] += 1
        offset += marker.length
      }
    }
  }

  const forbiddenBundleMarkers = Object.entries(markerCounts)
    .filter(([, count]) => count > 0)
    .map(([marker, count]) => ({ marker, count }))

  return {
    distDir: absoluteDist,
    htmlRouteCount: routes.length,
    routes,
    unexpectedRoutes,
    jsFileCount: jsFiles.length,
    jsBytes,
    forbiddenBundleMarkers,
    finalBoundarySatisfied: unexpectedRoutes.length === 0 && forbiddenBundleMarkers.length === 0,
  }
}

function parseArgs(argv) {
  let distDir = join(projectRoot, 'packages/app/dist')
  let requireFinal = false
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--require-final') requireFinal = true
    else if (arg === '--dist') {
      const value = argv[index + 1]
      if (!value) throw new Error('--dist requires a directory')
      distDir = resolve(value)
      index += 1
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return { distDir, requireFinal }
}

function main() {
  const { distDir, requireFinal } = parseArgs(process.argv.slice(2))
  const report = auditWebRetirement(distDir)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  if (requireFinal && !report.finalBoundarySatisfied) process.exitCode = 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
