// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/pair-qr.test.ts

export const PAIR_QR_RENDER_OPTIONS = { small: false } as const

export function buildPairQrPayload(pairToken: string): string {
  return `pair:${pairToken}`
}
