// @arch docs/architecture/app/modular-features.md
// @covers packages/app/src/features/chat/hooks/useChatAttachmentPreviews.ts
// @covers open-source/packages/shared/src/stores/chat.ts

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve, relative } from 'node:path'

const root = resolve(__dirname, '../../../..')
const checkedRoots = ['packages/app/src', 'open-source/packages/shared/src', 'open-source/packages/wire/src']
const allowed = new Set([
  'packages/app/src/components/chat/ChatWebView.web.tsx',
  'packages/app/src/components/chat/ChatWebMessageRenderer.web.tsx',
  'packages/app/src/components/chat/webview/markedJs.ts',
  'packages/app/src/polyfills/nativeRuntime.ts',
])

const modernRuntimePatterns = [
  '.flatMap(',
  '.flat(',
  '.at(',
  '.findLast(',
  '.findLastIndex(',
  '.toSorted(',
  '.toReversed(',
  '.toSpliced(',
  '.replaceAll(',
  'Object.hasOwn(',
  'structuredClone(',
]

function collectFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = resolve(dir, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) {
      if (entry === '__tests__') continue
      collectFiles(path, out)
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(path)
    }
  }
  return out
}

describe('native JavaScript runtime compatibility', () => {
  it('does not use modern JS helpers directly in native-reachable source files', () => {
    const files = checkedRoots.reduce<string[]>(
      (acc, dir) => acc.concat(collectFiles(resolve(root, dir))),
      [],
    )
    const offenders = files
      .map((path) => relative(root, path))
      .filter((path) => !allowed.has(path))
      .filter((path) => {
        const source = readFileSync(resolve(root, path), 'utf8')
        return modernRuntimePatterns.some((pattern) => source.includes(pattern))
      })

    expect(offenders).toEqual([])
  })
})
