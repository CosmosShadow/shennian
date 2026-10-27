// @covers packages/app/src/components/chat/webview/chatCss.ts

import { describe, expect, it } from 'vitest'
import { CHAT_CSS_NATIVE, CHAT_CSS_WEB } from '../components/chat/webview/chatCss'

describe('chat tool spacing', () => {
  it('separates tool summaries from the message above on native and web', () => {
    expect(CHAT_CSS_NATIVE).toContain(
      '.msg-row.msg-tool { padding-top:8px; padding-bottom:1px; }',
    )
    expect(CHAT_CSS_WEB).toContain(
      '.cwv .msg-row.msg-tool { padding-top:8px; padding-bottom:1px; }',
    )
  })

  it('keeps the collapsed process summary readable as secondary content', () => {
    expect(CHAT_CSS_NATIVE).toContain(
      '.process-collapse summary {\n  display:inline-flex; align-items:center; gap:6px; list-style:none; cursor:pointer;\n  color:var(--text-secondary); font-size:15px; line-height:22px;',
    )
    expect(CHAT_CSS_WEB).toContain(
      '.cwv .process-collapse summary {\n  display:inline-flex; align-items:center; gap:6px; list-style:none; cursor:pointer;\n  color:var(--text-secondary); font-size:15px; line-height:22px;',
    )
  })
})
