// @arch docs/architecture/app/chat-attachments-preview.md
// @test src/__tests__/capture-branding.test.ts

const QRCodeCore = require('qrcode/lib/core/qrcode') as {
  create(
    value: string,
    options?: { errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H' },
  ): {
    modules: { size: number; data: ArrayLike<boolean> }
  }
}

export const CAPTURE_BRAND_LOGO_DATA_URL =
  'data:image/png;base64,' +
  [
    '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',
    'ngAAAABJRU5ErkJggg==',
  ].join('')

export function normalizeCaptureBrandUrl(value: string): string {
  const raw = value.trim()
  if (!raw) return 'shennian.net'
  try {
    return new URL(raw.includes('://') ? raw : `https://${raw}`).host || raw
  } catch {
    return raw.replace(/^https?:\/\//i, '').replace(/\/.*$/, '') || 'shennian.net'
  }
}

export function getCaptureBrandHref(value: string): string {
  return `https://${normalizeCaptureBrandUrl(value)}`
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function createCaptureBrandQrSvg(value: string): string {
  const qr = QRCodeCore.create(value, { errorCorrectionLevel: 'M' })
  const quiet = 4
  const viewSize = qr.modules.size + quiet * 2
  const cells = [`<rect width="${viewSize}" height="${viewSize}" fill="#fff"/>`]

  for (let y = 0; y < qr.modules.size; y++) {
    for (let x = 0; x < qr.modules.size; x++) {
      if (qr.modules.data[y * qr.modules.size + x]) {
        cells.push(`<rect x="${x + quiet}" y="${y + quiet}" width="1" height="1" fill="#111"/>`)
      }
    }
  }

  return `<svg class="capture-brand-qr" viewBox="0 0 ${viewSize} ${viewSize}" aria-label="${escapeAttr(value)}" xmlns="http://www.w3.org/2000/svg">${cells.join('')}</svg>`
}
