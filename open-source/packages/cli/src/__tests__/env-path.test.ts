// @covers src/env-path.ts

import { describe, expect, it } from 'vitest'
import { buildAugmentedPath, getUserBinPathCandidates } from '../env-path'

describe('env path augmentation', () => {
  it('adds Windows system and bundled Shennian command locations', () => {
    const candidates = getUserBinPathCandidates({
      env: { SystemRoot: 'D:\\Windows', APPDATA: 'D:\\Users\\demo\\AppData\\Roaming' },
      homedir: 'D:\\Users\\demo',
      platform: 'win32',
    })

    expect(candidates).toEqual(expect.arrayContaining([
      'D:\\Users\\demo\\.shennian\\node',
      'D:\\Windows\\System32',
      'D:\\Windows\\System32\\WindowsPowerShell\\v1.0',
      'D:\\Windows',
      'D:\\Users\\demo\\AppData\\Roaming\\npm',
    ]))
  })

  it('adds user-level agent command locations for Finder and launchd environments', () => {
    const candidates = getUserBinPathCandidates({
      env: {},
      homedir: '/Users/demo',
      exists: (filePath) => filePath === '/Users/demo/.nvm/versions/node/v24.12.0/bin',
      readdir: (filePath) => {
        if (filePath === '/Users/demo/.nvm/versions/node') return ['v20.0.0', 'v24.12.0']
        return []
      },
    })

    expect(candidates).toEqual(expect.arrayContaining([
      '/Users/demo/.local/bin',
      '/Users/demo/.nvm/versions/node/v24.12.0/bin',
      '/opt/homebrew/bin',
      '/usr/local/bin',
    ]))
  })

  it('preserves existing PATH order and appends missing user bin paths once', () => {
    const value = buildAugmentedPath({
      pathValue: '/usr/bin:/bin:/Users/demo/.local/bin',
      env: {},
      homedir: '/Users/demo',
      exists: () => false,
      readdir: () => [],
    })

    const parts = value.split(':')
    expect(parts.slice(0, 3)).toEqual(['/usr/bin', '/bin', '/Users/demo/.local/bin'])
    expect(parts.filter((part) => part === '/Users/demo/.local/bin')).toHaveLength(1)
    expect(parts).toContain('/opt/homebrew/bin')
    expect(parts).toContain('/usr/local/bin')
  })
})
