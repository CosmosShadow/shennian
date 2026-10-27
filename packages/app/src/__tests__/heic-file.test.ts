// @covers ../features/uploads/heicFile.ts

import { describe, expect, it } from 'vitest'
import { isHeicFile, isInlineImage, uploadMediaKind } from '../features/uploads/heicFile'

describe('HEIC / HEIF plain-file identity', () => {
  it('recognises HEIC/HEIF by MIME or extension, whichever the picker provides', () => {
    expect(isHeicFile({ name: 'IMG_9718.HEIC', mimeType: 'application/octet-stream' })).toBe(true)
    expect(isHeicFile({ name: 'blob', mimeType: 'image/heif; charset=binary' })).toBe(true)
    expect(isHeicFile({ name: 'burst.heifs', mimeType: 'image/heic-sequence' })).toBe(true)
    expect(isHeicFile({ name: 'photo.png', mimeType: 'image/png' })).toBe(false)
    expect(isHeicFile({})).toBe(false)
  })

  it('classifies HEIC as an ordinary file and leaves other media kinds unchanged', () => {
    expect(uploadMediaKind({ name: 'IMG_9718.HEIC', mimeType: 'image/heic' })).toBe('file')
    expect(uploadMediaKind({ name: 'a.heif', mimeType: 'application/octet-stream' })).toBe('file')
    expect(uploadMediaKind({ name: 'a.png', mimeType: 'image/png' })).toBe('image')
    expect(uploadMediaKind({ name: 'a.jpg', mimeType: 'IMAGE/JPEG' })).toBe('image')
    expect(uploadMediaKind({ name: 'a.m4a', mimeType: 'audio/mp4' })).toBe('audio')
    expect(uploadMediaKind({ name: 'a.pdf', mimeType: 'application/pdf' })).toBe('file')
  })

  it('never treats HEIC as an image for thumbnails or previews', () => {
    expect(isInlineImage({ name: 'a.heic', mimeType: 'image/heic' })).toBe(false)
    expect(isInlineImage({ name: 'a.png', mimeType: 'image/png' })).toBe(true)
  })
})
