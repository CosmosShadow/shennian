#!/usr/bin/env node
// @arch docs/engineering/build-and-release.md
// @test scripts/__tests__/cache-bust-web-assets.test.mjs

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const STATIC_PREFIX = '/_expo/static/'

function walkFiles(dir) {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...walkFiles(path))
    } else if (entry.isFile()) {
      files.push(path)
    }
  }
  return files
}

function splitUrl(url) {
  const hashIndex = url.indexOf('#')
  const hash = hashIndex >= 0 ? url.slice(hashIndex) : ''
  const beforeHash = hashIndex >= 0 ? url.slice(0, hashIndex) : url
  const queryIndex = beforeHash.indexOf('?')
  return {
    path: queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash,
    query: queryIndex >= 0 ? beforeHash.slice(queryIndex + 1) : '',
    hash,
  }
}

function assetVersion(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex').slice(0, 16)
}

export function versionStaticAssetUrl(url, version) {
  if (!url.startsWith(STATIC_PREFIX)) return url
  const { path, query, hash } = splitUrl(url)
  const params = new URLSearchParams(query)
  params.set('v', version)
  return `${path}?${params.toString()}${hash}`
}

export function versionHtmlAssetReferences(html, versionsByPath) {
  return html.replace(/\b(src|href)=(["'])(\/_expo\/static\/[^"'\s<>]+)\2/g, (match, attr, quote, url) => {
    const { path } = splitUrl(url)
    const version = versionsByPath.get(path)
    if (!version) return match
    return `${attr}=${quote}${versionStaticAssetUrl(url, version)}${quote}`
  })
}

export function collectStaticAssetVersions(distDir) {
  const staticDir = resolve(distDir, '_expo/static')
  if (!statSync(staticDir, { throwIfNoEntry: false })?.isDirectory()) return new Map()

  const versions = new Map()
  for (const file of walkFiles(staticDir)) {
    const webPath = `/${relative(distDir, file).split(sep).join('/')}`
    versions.set(webPath, assetVersion(file))
  }
  return versions
}

export function versionExpoWebAssetReferences(distDir) {
  const root = resolve(distDir)
  const versionsByPath = collectStaticAssetVersions(root)
  if (versionsByPath.size === 0) return { filesChanged: 0, referencesChanged: 0 }

  let filesChanged = 0
  let referencesChanged = 0
  for (const file of walkFiles(root).filter((path) => path.endsWith('.html'))) {
    const html = readFileSync(file, 'utf8')
    let changedInFile = 0
    const nextHtml = html.replace(/\b(src|href)=(["'])(\/_expo\/static\/[^"'\s<>]+)\2/g, (match, attr, quote, url) => {
      const { path } = splitUrl(url)
      const version = versionsByPath.get(path)
      if (!version) return match
      const nextUrl = versionStaticAssetUrl(url, version)
      if (nextUrl === url) return match
      changedInFile += 1
      return `${attr}=${quote}${nextUrl}${quote}`
    })
    if (changedInFile > 0) {
      writeFileSync(file, nextHtml)
      filesChanged += 1
      referencesChanged += changedInFile
    }
  }

  return { filesChanged, referencesChanged }
}

async function main() {
  const distDir = process.argv[2]
  if (!distDir) {
    console.error('Usage: node scripts/cache-bust-web-assets.mjs <expo-web-dist-dir>')
    process.exit(1)
  }

  const result = versionExpoWebAssetReferences(distDir)
  console.log(
    `Versioned Expo Web static asset references in ${result.filesChanged} HTML files (${result.referencesChanged} references)`,
  )
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main()
}
