// @arch docs/features/manager-agent.md#九manager-与-worker-的可见-markdown
// @test src/__tests__/chat-web-timeline-virtualization.test.ts
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

export function MessageCopyButton({
  text,
  className = 'msg-copy-btn',
  label,
}: {
  text: string
  className?: string
  label?: string
}) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const idleLabel = label ?? t('copy')

  const handleCopy = useCallback(() => {
    if (!text.trim()) return
    void navigator.clipboard?.writeText(text)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }, [text])

  return (
    <button
      type="button"
      className={className}
      aria-label={copied ? t('copied') : idleLabel}
      onClick={handleCopy}
    >
      {copied ? t('copied') : idleLabel}
    </button>
  )
}
