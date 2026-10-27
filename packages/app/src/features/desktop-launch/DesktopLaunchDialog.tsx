// @arch docs/design/desktop/macos-interaction-baseline.md
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { DesktopDialog } from '../desktop-shell/DesktopDialog'

export function DesktopLaunchDialog({ children, onClose, title }: { children: ReactNode; onClose(): void; title?: string }) {
  const { t } = useTranslation()
  return <DesktopDialog title={title || t('new_conversation')} onClose={onClose}>{children}</DesktopDialog>
}
