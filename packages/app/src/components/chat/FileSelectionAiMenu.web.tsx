// @arch docs/architecture/app/chat-attachments-preview.md
// @test packages/app/src/__tests__/file-selection-ai.test.ts

import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { Colors } from '../../hooks/useTheme'
import {
  FILE_SELECTION_AI_ACTIONS,
  type FilePreviewSelection,
  type FileSelectionAiActionId,
} from './fileSelectionAi'

export function FileSelectionAiMenu({
  selection,
  colors,
  onAction,
  onQuote,
  onDismiss,
}: {
  selection: FilePreviewSelection
  colors: Colors
  onAction?: (actionId: FileSelectionAiActionId) => void
  onQuote?: () => void
  onDismiss: () => void
}) {
  const { t } = useTranslation()
  const [moreOpen, setMoreOpen] = useState(false)
  const pointerActionHandledRef = useRef(false)
  const primaryActions = FILE_SELECTION_AI_ACTIONS.slice(0, 4)
  const moreActions = FILE_SELECTION_AI_ACTIONS.slice(4)

  useEffect(() => {
    setMoreOpen(false)
    pointerActionHandledRef.current = false
  }, [
    selection.text,
    selection.rect.x,
    selection.rect.y,
    selection.rect.width,
    selection.rect.height,
  ])

  const runSelectionMenuAction = (event: MouseEvent<HTMLButtonElement>, action?: () => void) => {
    event.preventDefault()
    event.stopPropagation()
    action?.()
  }
  const runSelectionMenuPointerAction = (
    event: MouseEvent<HTMLButtonElement>,
    action?: () => void,
  ) => {
    pointerActionHandledRef.current = true
    runSelectionMenuAction(event, action)
  }
  const runSelectionMenuClickAction = (
    event: MouseEvent<HTMLButtonElement>,
    action?: () => void,
  ) => {
    if (pointerActionHandledRef.current) {
      pointerActionHandledRef.current = false
      event.preventDefault()
      event.stopPropagation()
      return
    }
    runSelectionMenuAction(event, action)
  }

  return (
    <div
      style={{
        position: 'absolute',
        left: Math.max(8, Math.min(selection.rect.x, 420)),
        top: Math.max(8, selection.rect.y - 46),
        zIndex: 20,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: 6,
        borderRadius: 14,
        border: `1px solid ${colors.border}`,
        background: colors.surface,
        boxShadow: '0 16px 40px rgba(0,0,0,0.18)',
      }}
    >
      {onQuote ? (
        <button
          key="quote"
          onMouseDown={(event) => runSelectionMenuPointerAction(event, onQuote)}
          onClick={(event) => runSelectionMenuClickAction(event, onQuote)}
          style={{
            border: 'none',
            borderRadius: 10,
            padding: '6px 9px',
            background: colors.brand,
            color: '#fff',
            fontSize: 12,
            fontWeight: 700,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {t('file_selection_quote')}
        </button>
      ) : null}
      {primaryActions.map((action) => (
        <button
          key={action.id}
          onMouseDown={(event) => runSelectionMenuPointerAction(event, () => onAction?.(action.id))}
          onClick={(event) => runSelectionMenuClickAction(event, () => onAction?.(action.id))}
          style={{
            border: 'none',
            borderRadius: 10,
            padding: '6px 9px',
            background: colors.surfaceHover,
            color: colors.text,
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {t(action.labelKey)}
        </button>
      ))}
      <div style={{ position: 'relative' }}>
        <button
          type="button"
          onMouseDown={(event) =>
            runSelectionMenuPointerAction(event, () => setMoreOpen((value) => !value))
          }
          onClick={(event) =>
            runSelectionMenuClickAction(event, () => setMoreOpen((value) => !value))
          }
          style={{
            border: 'none',
            borderRadius: 10,
            padding: '6px 9px',
            background: colors.surfaceHover,
            color: colors.textSecondary,
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {t('more')}
        </button>
        {moreOpen ? (
          <div
            style={{
              position: 'absolute',
              right: 0,
              top: 32,
              minWidth: 132,
              display: 'grid',
              gap: 4,
              padding: 6,
              borderRadius: 12,
              border: `1px solid ${colors.border}`,
              background: colors.surface,
              boxShadow: '0 16px 40px rgba(0,0,0,0.18)',
            }}
          >
            {moreActions.map((action) => (
              <button
                key={action.id}
                onMouseDown={(event) =>
                  runSelectionMenuPointerAction(event, () => onAction?.(action.id))
                }
                onClick={(event) => runSelectionMenuClickAction(event, () => onAction?.(action.id))}
                style={{
                  border: 'none',
                  borderRadius: 8,
                  padding: '7px 8px',
                  background: 'transparent',
                  color: colors.text,
                  textAlign: 'left',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {t(action.labelKey)}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <button
        onMouseDown={(event) => runSelectionMenuPointerAction(event, onDismiss)}
        onClick={(event) => runSelectionMenuClickAction(event, onDismiss)}
        aria-label={t('close')}
        style={{
          border: 'none',
          borderRadius: 10,
          padding: '6px 8px',
          background: 'transparent',
          color: colors.textTertiary,
          fontSize: 13,
          cursor: 'pointer',
        }}
      >
        ×
      </button>
    </div>
  )
}
