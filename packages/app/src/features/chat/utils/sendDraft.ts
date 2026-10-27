// @arch docs/architecture/app/chat-draft-storage.md
import type { PersonalSyncIdentity, ChatAttachmentMeta, PersonalAttachmentReference } from '@shennian/wire'
import type { UploadTaskLike } from '../hooks/useChatSendController'

export function hasExpectedPersonalSyncIdentity(
  value: Partial<PersonalSyncIdentity> | null | undefined,
  expected: PersonalSyncIdentity,
): boolean {
  return value?.protocolVersion === expected.protocolVersion &&
    value.dataEpoch === expected.dataEpoch &&
    value.daemonInstallationId === expected.daemonInstallationId
}

export function toPersistedDraftAttachments(tasks: UploadTaskLike[]): ChatAttachmentMeta[] {
  return tasks
    .filter((task) => task.progress >= 1 && !task.aborted && task.byteSize !== undefined && task.sha256)
    .map((task) => ({
      path: task.path,
      name: task.name,
      mimeType: task.mimeType,
      kind: task.kind,
      byteSize: task.byteSize,
      sha256: task.sha256,
    }))
}

export function toPersonalAttachmentReferences(
  attachments: readonly ChatAttachmentMeta[],
): PersonalAttachmentReference[] {
  return attachments.reduce<PersonalAttachmentReference[]>((result, attachment) => {
    if (
      typeof attachment.byteSize !== 'number' || attachment.byteSize < 0 ||
      typeof attachment.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(attachment.sha256)
    ) return result
    result.push({
      path: attachment.path,
      name: attachment.name,
      mimeType: attachment.mimeType,
      kind: attachment.kind,
      byteSize: attachment.byteSize,
      sha256: attachment.sha256.toLowerCase(),
    })
    return result
  }, [])
}

export function toDraftUploadTasks(attachments: ChatAttachmentMeta[]): UploadTaskLike[] {
  return attachments.map((attachment, index) => ({
    id: `draft-${index}-${attachment.name}`,
    path: attachment.path,
    name: attachment.name,
    mimeType: attachment.mimeType,
    kind: attachment.kind,
    byteSize: attachment.byteSize,
    sha256: attachment.sha256,
    progress: 1,
  }))
}

export function samePersistedDraft(
  left: { text: string; attachments: ChatAttachmentMeta[] } | null | undefined,
  right: { text: string; attachments: UploadTaskLike[] } | null,
): boolean {
  if (!left || !right) return false
  if (left.text !== right.text) return false

  const rightAttachments = toPersistedDraftAttachments(right.attachments)
  if (left.attachments.length !== rightAttachments.length) return false

  return left.attachments.every((attachment, index) => {
    const other = rightAttachments[index]
    return (
      attachment.path === other.path &&
      attachment.name === other.name &&
      attachment.mimeType === other.mimeType &&
      attachment.kind === other.kind &&
      attachment.byteSize === other.byteSize &&
      attachment.sha256 === other.sha256
    )
  })
}

