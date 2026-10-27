// @arch docs/architecture/app/modular-features.md
// @covers packages/app/src/utils/directoryNavigation.ts

import { describe, expect, it } from 'vitest'
import {
  FILE_SYSTEM_ROOTS_PATH,
  canGoUp,
  canGoUpWithinRoot,
  getParentDirectoryPath,
  getParentDirectoryPathWithinRoot,
} from '../utils/directoryNavigation'

describe('directory navigation utils', () => {
  it('detects when a posix path has a parent directory', () => {
    expect(canGoUp('/')).toBe(false)
    expect(canGoUp('/Users')).toBe(true)
    expect(canGoUp('/Users/example/projects')).toBe(true)
  })

  it('detects when a windows path has a parent directory', () => {
    expect(canGoUp('C:\\')).toBe(true)
    expect(canGoUp('C:\\Users')).toBe(true)
    expect(canGoUp('C:\\Users\\lichen')).toBe(true)
  })

  it('returns the parent directory for posix paths', () => {
    expect(getParentDirectoryPath('/Users/example/projects')).toBe('/Users/example')
    expect(getParentDirectoryPath('/Users')).toBe('/')
    expect(getParentDirectoryPath('/')).toBe('/')
  })

  it('returns the parent directory for windows paths', () => {
    expect(getParentDirectoryPath('C:\\Users\\lichen\\projects')).toBe('C:\\Users\\lichen')
    expect(getParentDirectoryPath('C:\\Users')).toBe('C:\\')
    expect(getParentDirectoryPath('C:\\')).toBe(FILE_SYSTEM_ROOTS_PATH)
  })

  it('handles empty string', () => {
    expect(canGoUp('')).toBe(false)
    expect(getParentDirectoryPath('')).toBe('/')
  })

  it('handles tilde (home shorthand) as opaque single segment', () => {
    expect(canGoUp('~')).toBe(false)
  })

  it('handles trailing slashes', () => {
    expect(canGoUp('/Users/foo/')).toBe(true)
    expect(getParentDirectoryPath('/Users/foo/')).toBe('/Users')
  })

  it('handles root with trailing slash', () => {
    expect(canGoUp('/')).toBe(false)
  })

  it('handles windows root with trailing backslash', () => {
    expect(canGoUp('C:\\')).toBe(true)
    expect(getParentDirectoryPath('C:\\')).toBe(FILE_SYSTEM_ROOTS_PATH)
  })

  it('handles single-level posix path', () => {
    expect(canGoUp('/Users')).toBe(true)
    expect(getParentDirectoryPath('/Users')).toBe('/')
  })

  it('handles single-level windows path', () => {
    expect(canGoUp('C:\\Users')).toBe(true)
    expect(getParentDirectoryPath('C:\\Users')).toBe('C:\\')
  })

  it('handles virtual file system roots as top-level navigation', () => {
    expect(canGoUp(FILE_SYSTEM_ROOTS_PATH)).toBe(false)
    expect(getParentDirectoryPath(FILE_SYSTEM_ROOTS_PATH)).toBe(FILE_SYSTEM_ROOTS_PATH)
  })

  it('stops at authorized Windows workDir instead of D drive root', () => {
    const root = 'D:\\project'
    expect(canGoUpWithinRoot('D:\\project', root)).toBe(false)
    expect(getParentDirectoryPathWithinRoot('D:\\project', root)).toBe(root)
    expect(canGoUpWithinRoot('D:\\project\\src', root)).toBe(true)
    expect(getParentDirectoryPathWithinRoot('D:\\project\\src', root)).toBe(root)
  })

  it('does not compute a parent outside authorized root after normalization-like navigation', () => {
    const root = '/Users/alice/project'
    expect(canGoUpWithinRoot('/Users/alice/project', root)).toBe(false)
    expect(getParentDirectoryPathWithinRoot('/Users/alice/project', root)).toBe(root)
    expect(getParentDirectoryPathWithinRoot('/Users/alice/project/src', root)).toBe(root)
  })
})
