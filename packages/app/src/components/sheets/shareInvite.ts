// @test packages/app/src/__tests__/share-sheet.test.ts

export function buildShareInvitePayload(shareToken: string): string {
  return `share:${shareToken}`
}
