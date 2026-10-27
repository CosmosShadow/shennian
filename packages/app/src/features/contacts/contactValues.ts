// @arch docs/architecture/app/render-resilience.md
// @test src/__tests__/runtime-values.test.ts
import { collectMapped, isRecord } from '../../utils/runtimeValues'
import { normalizeDisplayText } from '../../components/headEllipsis'
import type { ContactAvatar, SavedContact } from './contactAccountClient'

export function normalizeContacts(value: unknown): SavedContact[] {
  if (!Array.isArray(value)) return []
  return collectMapped(value, (item) => {
    if (!isRecord(item) || typeof item.id !== 'string' || !item.id || (item.kind !== 'human' && item.kind !== 'agent')) return []
    const contact: SavedContact = {
      id: item.id, kind: item.kind, displayName: normalizeDisplayText(item.displayName), avatar: contactAvatar(item.avatar),
    }
    for (const key of ['userId', 'agentIdentityId', 'publicId', 'agentWorkspaceId', 'savedAt'] as const) {
      if (typeof item[key] === 'string') contact[key] = item[key]
    }
    if (typeof item.owned === 'boolean') contact.owned = item.owned
    if (typeof item.plazaListed === 'boolean') contact.plazaListed = item.plazaListed
    return [contact]
  })
}
function contactAvatar(value: unknown): ContactAvatar {
  if (!isRecord(value) || typeof value.smallUrl !== 'string' || typeof value.mediumUrl !== 'string') return null
  return { smallUrl: value.smallUrl, mediumUrl: value.mediumUrl,
    version: typeof value.version === 'string' ? value.version : '',
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '' }
}
