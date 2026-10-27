// @arch docs/architecture/mobile-navigation.md
// @test src/__tests__/steward-inspiration.test.ts

type Storage = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> }
const key = (accountId: string) => `shennian:inspiration:visible:v1:${accountId}`

/** Local account preference; a malformed value or failed read must not strand the entry. */
export async function readInspirationVisible(storage: Storage, accountId: string): Promise<boolean> {
  if (!accountId) return true
  try { return (await storage.getItem(key(accountId))) !== 'false' } catch { return true }
}
export async function writeInspirationVisible(storage: Storage, accountId: string, visible: boolean): Promise<void> {
  if (!accountId) throw new Error('inspiration_account_required')
  await storage.setItem(key(accountId), String(visible))
}

export function inspirationSendBlock(state: {
  input: string; attachments: number; sending: boolean; uploading: boolean; editing: boolean
  voicePhase: string; ready: boolean
}): 'inspiration_finish_draft' | 'inspiration_unavailable' | null {
  if (state.input.trim() || state.attachments || state.editing) return 'inspiration_finish_draft'
  if (!state.ready || state.sending || state.uploading || state.voicePhase === 'listening' || state.voicePhase === 'refining') {
    return 'inspiration_unavailable'
  }
  return null
}
