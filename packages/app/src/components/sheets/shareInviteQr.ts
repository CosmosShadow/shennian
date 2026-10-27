// @test packages/app/src/__tests__/share-sheet.test.ts

const QRCodeCore = require('qrcode/lib/core/qrcode') as {
  create(
    value: string,
    options?: { errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H' },
  ): {
    modules: { size: number; data: ArrayLike<boolean> }
  }
}

export type ShareInviteQrMatrix = {
  size: number
  data: boolean[]
}

export function createShareInviteQrMatrix(value: string): ShareInviteQrMatrix {
  if (!value.trim()) {
    throw new Error('QR value is empty')
  }

  const qr = QRCodeCore.create(value, { errorCorrectionLevel: 'M' })
  const quiet = 4
  const size = qr.modules.size + quiet * 2
  const data = new Array<boolean>(size * size).fill(false)

  for (let y = 0; y < qr.modules.size; y++) {
    for (let x = 0; x < qr.modules.size; x++) {
      if (qr.modules.data[y * qr.modules.size + x]) {
        data[(y + quiet) * size + x + quiet] = true
      }
    }
  }

  return { size, data }
}
