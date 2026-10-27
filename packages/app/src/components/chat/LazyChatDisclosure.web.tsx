// @arch docs/features/desktop-local-first-client.md#54-同步与服务器压力
// @test src/__tests__/chat-web-timeline-virtualization.test.ts
import React, { useState, type ReactNode, type SyntheticEvent } from 'react'

/** Keep native summary/keyboard semantics without constructing hidden history. */
export function LazyChatDisclosure({
  className,
  summary,
  children,
  onToggle,
}: {
  className: string
  summary: ReactNode
  children: () => ReactNode
  onToggle?: (event: SyntheticEvent<HTMLDetailsElement>) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <details className={className} onToggle={(event) => {
      // Nested tool toggles must not close or fetch the parent disclosure.
      if (event.target !== event.currentTarget) return
      setOpen(event.currentTarget.open)
      onToggle?.(event)
    }}>
      {summary}
      {open ? children() : null}
    </details>
  )
}
