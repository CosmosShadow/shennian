// @covers src/room/invite-qr.ts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createRoomInviteQr } from '../room/invite-qr.js'

describe('Room invitation QR', () => {
  it('writes a private PNG that encodes the public invitation URL', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shennian-room-invite-qr-'))
    const inviteUrl = `https://app.shennian.net/spaces/room_1?invite=${'i'.repeat(43)}`
    try {
      const result = await createRoomInviteQr(inviteUrl, root)

      expect(result).toEqual({
        imagePath: expect.stringMatching(/room-invite-[a-f0-9]{24}\.png$/),
        mimeType: 'image/png',
        payload: inviteUrl,
        dataUrl: expect.stringMatching(/^data:image\/png;base64,/),
      })
      expect(path.isAbsolute(result.imagePath)).toBe(true)
      expect(fs.readFileSync(result.imagePath).subarray(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      )
      expect(Buffer.from(result.dataUrl.slice('data:image/png;base64,'.length), 'base64')).toEqual(
        fs.readFileSync(result.imagePath),
      )
      if (process.platform !== 'win32') {
        expect(fs.statSync(result.imagePath).mode & 0o777).toBe(0o600)
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
