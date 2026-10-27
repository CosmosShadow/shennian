// @arch open-source/docs/wire.md
// @test open-source/packages/wire/src/__tests__/external-message-format.test.ts

export type ExternalMessageFormatAttachment = {
  type?: string
  name?: string
  path?: string
  url?: string
  localPath?: string
  thumbnailPath?: string
  mimeType?: string
  availability?: string
  providerError?: string
}

export type ExternalMessageFormatMessage = {
  senderName?: string | null
  senderId?: string | null
  text?: string | null
  attachments?: ExternalMessageFormatAttachment[]
  isTrigger?: boolean
  timestampLabel?: string | null
}

export type FormattedExternalConversationMessage = {
  text: string
  attachmentLines: string[]
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

function escapeMarkdownLabel(value: string): string {
  return value.replace(/[[\]\\]/g, '\\$&')
}

function markdownLink(label: string, href: string): string {
  return `[${escapeMarkdownLabel(label)}](<${href}>)`
}

function externalAttachmentHref(attachment: ExternalMessageFormatAttachment): string {
  return cleanText(attachment.path)
    || cleanText(attachment.url)
    || cleanText(attachment.localPath)
    || cleanText(attachment.thumbnailPath)
}

function externalAttachmentName(attachment: ExternalMessageFormatAttachment, index: number): string {
  const pathParts = cleanText(attachment.path || attachment.url || attachment.localPath || attachment.thumbnailPath).split('/').filter(Boolean)
  return cleanText(attachment.name)
    || pathParts[pathParts.length - 1]
    || `attachment-${index + 1}`
}

function unavailableStatus(attachment: ExternalMessageFormatAttachment): string {
  return cleanText(attachment.providerError)
    || cleanText(attachment.availability)
    || ''
}

export function formatExternalAttachmentReference(
  attachment: ExternalMessageFormatAttachment,
  index = 0,
): string {
  const name = externalAttachmentName(attachment, index)
  const href = externalAttachmentHref(attachment)
  if (href) return markdownLink(name, href)
  const status = unavailableStatus(attachment)
  return status ? `${name} (${status})` : name
}

export function formatExternalMessageLine(input: {
  senderName?: string | null
  senderId?: string | null
  text?: string | null
  isTrigger?: boolean
  timestampLabel?: string | null
}): string {
  const sender = cleanText(input.senderName) || cleanText(input.senderId) || '对方'
  const text = cleanText(input.text)
  const prefix = input.isTrigger ? '=> ' : ''
  const time = cleanText(input.timestampLabel)
  const head = `${prefix}${time ? `${time} ` : ''}${sender}:`
  return text ? `${head} ${text}` : head
}

export function formatExternalConversationMessage(
  message: ExternalMessageFormatMessage,
): FormattedExternalConversationMessage {
  const line = formatExternalMessageLine(message)
  const sender = cleanText(message.senderName) || cleanText(message.senderId) || '对方'
  const attachmentLines = (message.attachments ?? []).map((attachment, index) => {
    return `${sender}: ${formatExternalAttachmentReference(attachment, index)}`
  })
  const lines = [
    line,
    ...attachmentLines,
  ].filter(Boolean)
  return {
    text: lines.join('\n'),
    attachmentLines,
  }
}

export function formatExternalConversationText(input: {
  conversationName?: string | null
  messages: ExternalMessageFormatMessage[]
  includeContextLabel?: boolean
}): string {
  const conversationName = cleanText(input.conversationName)
  const header = [
    input.includeContextLabel ? '外部消息上下文（@触发）' : '',
    `外部对话: ${conversationName || '未命名对话'}`,
  ].filter(Boolean)
  const body = input.messages
    .map((message) => formatExternalConversationMessage(message).text)
    .filter(Boolean)
  return [...header, ...body].join('\n')
}
