// @covers src/features/desktop-files/DesktopProjectFilesController.tsx

import { describe, expect, it } from 'vitest'
import { decodeBase64Chunks } from '../features/desktop-files/model/desktopProjectFilePreviewBytes'

describe('Desktop opaque file preview assembly', () => {
  it('joins independently padded chunks as bytes rather than concatenating invalid base64', () => {
    const chunks = [btoa('ab'), btoa('cde'), btoa('f')]
    const bytes = decodeBase64Chunks(chunks, 6)
    expect(new TextDecoder().decode(bytes)).toBe('abcdef')
  })

  it('fails closed when chunk bytes do not match the authenticated total size', () => {
    expect(() => decodeBase64Chunks([btoa('abc')], 2)).toThrow('project_fs_protocol')
    expect(() => decodeBase64Chunks([btoa('a')], 2)).toThrow('project_fs_protocol')
  })
})
