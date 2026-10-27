/**
 * @covers packages/app/app
 * @covers packages/app/src
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOTS = [
  resolve(__dirname, '../../app'),
  resolve(__dirname, '..'),
]

const SKIP_DIRS = new Set(['__tests__', 'webview'])
const EXTENSIONS = new Set(['.ts', '.tsx'])

function extensionOf(path: string): string {
  const match = path.match(/\.[^.]+$/)
  return match?.[0] ?? ''
}

function collectSourceFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) {
      if (!SKIP_DIRS.has(entry)) files.push(...collectSourceFiles(path))
      continue
    }
    if (EXTENSIONS.has(extensionOf(path))) files.push(path)
  }
  return files
}

function collectRouteCollisions(dir: string, prefix = ''): string[] {
  const entries = readdirSync(dir)
  const dirs = new Set<string>()
  const routeFiles = new Set<string>()
  const collisions: string[] = []

  for (const entry of entries) {
    const path = join(dir, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) {
      dirs.add(entry)
      collisions.push(...collectRouteCollisions(path, join(prefix, entry)))
      continue
    }

    const ext = extname(entry)
    if (!EXTENSIONS.has(ext)) continue
    routeFiles.add(entry.slice(0, -ext.length))
  }

  for (const routeFile of routeFiles) {
    if (dirs.has(routeFile)) {
      const nested = readdirSync(join(dir, routeFile))
      if (nested.some((entry) => /^index(?:\.(?:ios|android|native|web))?\.tsx?$/.test(entry))) {
        collisions.push(join(prefix, routeFile))
      }
    }
  }

  return collisions
}

describe('navigation stack semantics', () => {
  it('does not mount or feed foreground internal message cards', () => {
    for (const file of ['../../app/(main)/_layout.tsx', '../config/sync.ts', '../hooks/usePushNotifications.ts']) {
      const source = readFileSync(resolve(__dirname, file), 'utf-8')
      expect(source).not.toMatch(/InAppNoticeHost|offerInAppNotice|offerRoomNotice|offerPushNotice/)
    }
  })

  it('only pushes the explicit feature and settings entrypoints', () => {
    const offenders = ROOTS
      .flatMap(collectSourceFiles)
      .filter((path) => readFileSync(path, 'utf-8').includes('router.push'))
      .map((path) => relative(resolve(__dirname, '../../..'), path))

    expect(offenders.sort()).toEqual([
      'app/src/features/mobile-navigation/FeaturesScreen.tsx',
      'app/src/features/profile/ProfileScreen.tsx',
      'app/src/features/profile/GeneralSettingsScreen.tsx',
      // Schedule display preferences are an explicit settings page with back navigation.
      'app/src/features/personal-modules/PersonalScheduleScreen.tsx',
      // Recording settings and day details use the native stack and back navigation.
      'app/src/features/personal-modules/PersonalModulesScreen.tsx',
      'app/src/features/remote-folders/FoldersScreen.tsx',
      'app/src/features/mobile-navigation/ShennianHomeScreen.tsx',
      'app/src/features/steward/StewardScreen.tsx',
      'app/src/features/steward/StewardSettingsScreen.tsx',
      // Project coordination and its task links are explicit pages with back navigation.
      'app/src/features/projects/screens/ProjectScreen.tsx',
      'app/src/features/projects/coordination/ProjectCoordinationComposer.tsx',
      'app/src/features/projects/coordination/ProjectCoordinationScreen.tsx',
    ].sort())
  })

  it('keeps nested dynamic chat routes in a directory route', () => {
    const appRoot = resolve(__dirname, '../../app')
    const mainLayout = readFileSync(join(appRoot, '(main)/_layout.tsx'), 'utf-8')

    expect(existsSync(join(appRoot, '(main)/chat/[sessionId].tsx'))).toBe(false)
    expect(existsSync(join(appRoot, '(main)/chat/[sessionId]/index.tsx'))).toBe(true)
    expect(existsSync(join(appRoot, '(main)/chat/[sessionId]/preview.tsx'))).toBe(true)
    expect(mainLayout).toContain('name="chat/[sessionId]/index"')
    expect(mainLayout).toContain('name="chat/[sessionId]/external-channel/index"')
    expect(mainLayout).not.toContain('name="chat/[sessionId]"')
    expect(mainLayout).not.toContain('name="chat/[sessionId]/external-channel"')
  })

  it('does not define the same route as both a page file and directory', () => {
    const appRoot = resolve(__dirname, '../../app')

    expect(collectRouteCollisions(appRoot)).toEqual([])
  })
})
