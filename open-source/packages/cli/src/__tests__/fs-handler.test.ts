// @covers src/fs/handler.ts

import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'

import { handleFsLs } from '../fs/handler.js'

describe('fs handler roots navigation', () => {
  it('returns Windows drive roots for __roots__', () => {
    vi.spyOn(os, 'platform').mockReturnValue('win32')
    vi.spyOn(fs, 'existsSync')
      .mockImplementation((target) => target === 'C:\\' || target === 'E:\\')

    expect(handleFsLs('__roots__')).toEqual({
      entries: [
        { name: 'C:\\', path: 'C:\\', isDir: true },
        { name: 'E:\\', path: 'E:\\', isDir: true },
      ],
    })
  })
})
