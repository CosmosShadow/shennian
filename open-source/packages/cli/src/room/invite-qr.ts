// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/room-invite-qr.test.ts

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import QRCode from 'qrcode'
import { resolveShennianPath } from '../config/index.js'

export type RoomInviteQr = {
  imagePath: string
  mimeType: 'image/png'
  payload: string
  dataUrl: string
}

export async function createRoomInviteQr(
  inviteUrl: string,
  rootDirectory = resolveShennianPath('room-invites'),
): Promise<RoomInviteQr> {
  fs.mkdirSync(rootDirectory, { recursive: true, mode: 0o700 })
  const digest = crypto.createHash('sha256').update(inviteUrl).digest('hex').slice(0, 24)
  const imagePath = path.resolve(rootDirectory, `room-invite-${digest}.png`)
  await QRCode.toFile(imagePath, inviteUrl, {
    type: 'png',
    width: 640,
    margin: 4,
    errorCorrectionLevel: 'M',
  })
  fs.chmodSync(imagePath, 0o600)
  const image = fs.readFileSync(imagePath)
  return {
    imagePath,
    mimeType: 'image/png',
    payload: inviteUrl,
    dataUrl: `data:image/png;base64,${image.toString('base64')}`,
  }
}
