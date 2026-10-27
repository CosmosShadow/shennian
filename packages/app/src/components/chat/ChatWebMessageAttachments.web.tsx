// @arch docs/architecture/app/chat-attachments-preview.md
// @test src/__tests__/chat-web-timeline-virtualization.test.ts

import { useTranslation } from 'react-i18next'
import type { ChatAttachment } from '@shennian/shared'
import { createAttachmentImageActionHandlers } from './attachmentImageActions'
import { useWebAttachmentPreview } from './webAttachmentPreview.web'

export function UserAttachmentPreview({
  attachment,
  onOpen,
  onImageContextMenu,
}: {
  attachment: ChatAttachment
  onOpen: (path: string) => void
  onImageContextMenu?: (path: string) => void
}) {
  const { t } = useTranslation()
  const { nodeRef, previewSource } = useWebAttachmentPreview(attachment)
  const imageActions = createAttachmentImageActionHandlers(attachment.path, {
    open: onOpen,
    openActions: onImageContextMenu,
  })
  if (attachment.kind === 'image' && previewSource) {
    return (
      <span className="attachment-image-actions">
        <button
          ref={nodeRef}
          type="button"
          className="attachment-thumb-btn"
          data-resource-path={attachment.path}
          onContextMenu={imageActions.contextMenu}
        >
          <img src={previewSource} alt={attachment.name} className="attachment-thumb" />
        </button>
        {onImageContextMenu ? (
          <button
            type="button"
            className="attachment-actions-btn"
            aria-label={t('more')}
            onClick={imageActions.openActions}
          >
            ⋯
          </button>
        ) : null}
      </span>
    )
  }

  if (attachment.kind === 'image') {
    return (
      <span className="attachment-image-actions">
        <button
          ref={nodeRef}
          type="button"
          className="attachment-image-placeholder"
          data-resource-path={attachment.path}
          onContextMenu={imageActions.contextMenu}
        >
          <span className="placeholder-icon">🖼</span>
        </button>
        {onImageContextMenu ? (
          <button
            type="button"
            className="attachment-actions-btn"
            aria-label={t('more')}
            onClick={imageActions.openActions}
          >
            ⋯
          </button>
        ) : null}
      </span>
    )
  }

  return (
    <button type="button" className="attachment-file-card" onClick={() => onOpen(attachment.path)}>
      <span className="attachment-file-icon">📄</span>
      <span className="attachment-file-name">{attachment.name}</span>
    </button>
  )
}
