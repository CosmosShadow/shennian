// @arch docs/design/desktop/macos-interaction-baseline.md
// @test ../../__tests__/chat-font-size.test.ts
import { desktopChatTypography, type ChatFontSize } from '../chat/preferences/chatFontSize'
import { desktopControlMetrics, desktopTypography } from '../desktop-shell/desktopDesignTokens'

/** Desktop summaries share the reading scale of their associated reply. */
export function desktopChatProcessCss(enabled: boolean, size: ChatFontSize = 'medium'): string {
  if (!enabled) return ''
  const body = desktopChatTypography[size].body
  const meta = desktopTypography.metadata
  const code = desktopTypography.code
  return `
.cwv.cwv-desktop .msg-row.msg-tool { padding-bottom:0; }
.cwv.cwv-desktop .bubble-agent { padding-top:0; }
.cwv.cwv-desktop .process-collapse { margin:4px 0; }
.cwv.cwv-desktop .process-collapse + .msg-row { padding-top:0; }
.cwv.cwv-desktop .process-collapse + .msg-row .bubble-agent { padding-top:0; }
.cwv.cwv-desktop .bubble-agent .md > :first-child { margin-top:0; }

.cwv.cwv-desktop .tool-disclosure > summary,
.cwv.cwv-desktop .tool-disclosure > summary .tool-title,
.cwv.cwv-desktop .process-collapse > summary,
.cwv.cwv-desktop .thinking-block > summary {
  font-size:${body.fontSize}px; line-height:${body.lineHeight}px; font-weight:400;
  color:var(--text-secondary);
}
.cwv.cwv-desktop .tool-disclosure > summary,
.cwv.cwv-desktop .process-collapse > summary,
.cwv.cwv-desktop .thinking-block > summary {
  box-sizing:border-box; min-height:${body.lineHeight + 8}px; padding-top:4px; padding-bottom:4px;
  border-radius:${desktopControlMetrics.radiusSmall}px;
}
.cwv.cwv-desktop .tool-disclosure > summary:hover,
.cwv.cwv-desktop .process-collapse > summary:hover,
.cwv.cwv-desktop .thinking-block > summary:hover { background:var(--surface-hover); }
.cwv.cwv-desktop .tool-disclosure summary:focus-visible,
.cwv.cwv-desktop .process-collapse > summary:focus-visible,
.cwv.cwv-desktop .thinking-block > summary:focus-visible { outline:2px solid var(--brand); outline-offset:2px; }
.cwv.cwv-desktop .tool-disclosure .tool-meta,
.cwv.cwv-desktop .tool-group .tool-item-label,
.cwv.cwv-desktop .tool-group .tool-item-meta,
.cwv.cwv-desktop .tool-detail-hint,
.cwv.cwv-desktop .tool-code-truncated {
  font-size:${meta.fontSize}px; line-height:${meta.lineHeight}px; color:var(--text-secondary);
}
.cwv.cwv-desktop .tool-disclosure .tool-label {
  font-size:${meta.fontSize}px; line-height:${meta.lineHeight}px; color:var(--text-secondary); text-transform:none;
}
.cwv.cwv-desktop .tool-disclosure .tool-code {
  font-size:${code.fontSize}px; line-height:${code.lineHeight}px;
}
@media (prefers-reduced-motion: reduce) {
  .cwv.cwv-desktop .tool-disclosure .tool-status-running span { animation:none; opacity:.7; transform:none; }
}
`
}
