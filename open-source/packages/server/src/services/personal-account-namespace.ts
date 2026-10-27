// @arch open-source/docs/server-runtime.md
// @test src/__tests__/personal-account-namespace.test.ts

import crypto from 'node:crypto'

export function personalAccountNamespaceId(accountId: string): string {
  if (!accountId || accountId.length > 191) throw new Error('invalid account identity')
  return crypto.createHash('sha256')
    .update(`shennian-personal-sync-account-v1\0${accountId}`)
    .digest('hex')
}
