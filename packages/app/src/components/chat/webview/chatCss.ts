// @arch docs/design/foundations.md
// @test src/__tests__/chat-webview-markdown.test.ts
import { workerCardCss } from './workerCardCss'
/**
 * Shared CSS for the chat WebView renderer.
 *
 * Exports:
 *   CHAT_CSS_NATIVE — full CSS injected into the native WebView (via build.ts → bundledHtml.ts)
 *   CHAT_CSS_WEB    — full CSS injected into the web renderer (via ChatWebView.web.tsx <style>)
 *
 * Both share the same component styles. The only differences are:
 *   - Native: bare class names, html/body reset, 16px font, streaming caret
 *   - Web: `.cwv`-scoped selectors, 14px font, max-width layout, hover states
 */

/** CSS injected into the native WebView HTML. Class names are unscoped (full HTML document). */
export const CHAT_CSS_NATIVE = `
*,*::before,*::after { box-sizing:border-box; margin:0; padding:0; }

:root {
  --bg:#ffffff; --surface:#fafafa; --surface-hover:#f5f5f5; --border:#f0f0f0;
  --text:#111111; --text-secondary:#666666; --text-tertiary:#999999;
  --brand:#4f46e5; --brand-dark:#4338ca; --brand-light:#eef2ff; --own-message:rgba(59,130,246,0.08);
  --error:#ef4444; --success:#22c55e; --warning:#f59e0b;
}
.dark {
  --bg:#0a0a0a; --surface:#171717; --surface-hover:#262626; --border:#262626;
  --text:#fafafa; --text-secondary:#a3a3a3; --text-tertiary:#737373;
  --brand:#818cf8; --brand-dark:#6366f1; --brand-light:#1e1b4b; --own-message:rgba(96,165,250,0.12);
  --error:#f87171; --success:#4ade80; --warning:#fbbf24;
}

html, body {
  height:100%; margin:0; padding:0; background:var(--bg);
  font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',Roboto,Helvetica,Arial,sans-serif;
  font-size:16px; line-height:1.5; color:var(--text);
  -webkit-font-smoothing:antialiased; -moz-osx-font-smoothing:grayscale;
  overflow:hidden; -webkit-text-size-adjust:100%;
}
#scroll-root { height:100%; overflow-y:auto; overflow-x:hidden; -webkit-overflow-scrolling:touch; }
#messages { padding:8px 0 16px; min-height:100%; }
.chat-virtual-spacer { width:1px; pointer-events:none; }
.chat-virtual-window { min-height:1px; }
.chat-virtual-item { display:flow-root; }
.chat-math-block { margin:12px 0; overflow-x:auto; overflow-y:hidden; text-align:center; -webkit-overflow-scrolling:touch; }
.chat-math-block math { display:inline-block; max-width:none; font-size:1.08em; }
.chat-math-inline { display:inline-block; max-width:100%; vertical-align:-0.12em; }
.chat-math-inline math { font-size:1em; }
.chat-math-fallback { white-space:pre-wrap; overflow-wrap:anywhere; }

.time-separator { display:flex; justify-content:center; padding:8px 0; }
.time-separator span { font-size:11px; color:var(--text-tertiary); }
.msg-divider { display:flex; align-items:center; gap:12px; padding:14px 16px; }
.msg-divider .divider-line { flex:1; height:1px; background:var(--border); }
.msg-divider .divider-label { font-size:12px; color:var(--text-tertiary); white-space:nowrap; }

.msg-row { padding:4px 16px; }
${workerCardCss()}

.msg-row.msg-tool { padding-top:8px; padding-bottom:1px; }
.msg-user { display:flex; flex-direction:column; justify-content:flex-end; align-items:flex-end; gap:0; }
.msg-agent { display:flex; flex-direction:column; }
.user-wrap { display:flex; flex-direction:column; align-items:flex-end; max-width:calc(100% - 32px); }
.ref-tag { color:var(--brand); font-weight:500; }

.bubble-user {
  background:var(--own-message);
  border-radius:18px 18px 6px 18px; padding:10px 16px; color:var(--text);
  font-size:15px; line-height:24px; overflow-wrap:break-word; white-space:pre-wrap;
}
.bubble-user.error { opacity:0.7; }
.bubble-user .md {
  font-size:15px; line-height:24px; color:var(--text); white-space:normal;
  overflow-wrap:anywhere; word-break:break-word;
}
.bubble-user .md > *:first-child { margin-top:0; }
.bubble-user .md > *:last-child { margin-bottom:0; }
.bubble-user .md p { margin:4px 0; }
.bubble-user .md p:first-child { margin-top:0; }
.bubble-user .md p:last-child { margin-bottom:0; }
.bubble-user .md h1, .bubble-user .md h2, .bubble-user .md h3,
.bubble-user .md h4, .bubble-user .md h5, .bubble-user .md h6 {
  font-size:15px; line-height:22px; font-weight:700; margin:6px 0 4px;
  overflow-wrap:anywhere; word-break:break-word;
}
.bubble-user .md ul, .bubble-user .md ol {
  margin:6px 0; padding-left:22px; list-style-position:outside;
}
.bubble-user .md li { margin:4px 0; padding-left:2px; }
.bubble-user .md li > p { margin:0; }
.bubble-user .md li::marker {
  color:color-mix(in srgb, var(--text) 72%, transparent);
  font-weight:600;
}
.bubble-user .md code:not(pre code) {
  background:color-mix(in srgb, var(--text) 10%, transparent);
  border-radius:6px; padding:2px 6px;
  font-family:'SF Mono','Menlo','Consolas',monospace;
  font-size:0.88em; line-height:1.6; color:var(--text);
  -webkit-box-decoration-break:clone; box-decoration-break:clone;
  overflow-wrap:anywhere; word-break:break-word;
}
.bubble-user .md blockquote {
  margin:6px 0; padding-left:12px; border-left:3px solid color-mix(in srgb, var(--text) 16%, transparent);
  color:color-mix(in srgb, var(--text) 84%, transparent);
}
.bubble-user .md a { color:var(--brand); text-decoration:none; }
.bubble-user .md a:hover { text-decoration:underline; }
.resource-line-label { margin-left:4px; color:var(--text-tertiary); font-size:0.9em; white-space:nowrap; }
.user-attachments { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:8px; }
.attachment-thumb-btn,
.attachment-file-card,
.resource-pill {
  border:none; background:none; padding:0; color:inherit; cursor:pointer;
}
.attachment-thumb-btn { border-radius:12px; overflow:hidden; max-width:240px; }
.attachment-thumb {
  display:block; width:100%; max-width:240px; max-height:240px; object-fit:cover;
  border-radius:12px; background:var(--surface-hover);
}
.attachment-thumb-fallback {
  width:120px; height:90px; border-radius:12px;
  background:var(--surface); border:1px solid var(--border);
  display:none; align-items:center; justify-content:center; gap:4px;
  flex-direction:column;
}
.attachment-image-placeholder {
  width:120px; height:90px; border-radius:12px; overflow:hidden;
  background:var(--surface); border:1px solid var(--border);
  display:flex; align-items:center; justify-content:center; gap:4px;
  flex-direction:column; cursor:pointer;
}
.attachment-image-placeholder .placeholder-icon { font-size:24px; line-height:1; opacity:0.5; }
.attachment-image-placeholder .placeholder-label {
  font-size:10px; color:var(--text-tertiary); max-width:100px;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; text-align:center; padding:0 8px;
}
.attachment-file-card {
  display:flex; align-items:center; gap:8px; max-width:220px;
  padding:10px 12px; border-radius:12px; background:var(--surface);
  border:1px solid var(--border); text-align:left;
}
.attachment-file-icon { font-size:16px; line-height:1; }
.attachment-file-name {
  font-size:13px; line-height:18px; color:var(--text);
  word-break:break-word;
}
.resource-pill {
  display:inline-flex; align-items:center; gap:6px;
  margin:4px 0; padding:8px 10px; border-radius:10px;
  background:var(--surface); border:1px solid var(--border);
  color:var(--brand); font-size:13px; line-height:18px;
}
.resource-pill-image::before { content:'🖼'; }

.msg-status { display:flex; align-items:center; justify-content:flex-end; gap:4px; font-size:12px; line-height:17px; padding:4px 4px 2px; flex-shrink:0; }
.msg-status .sending { display:inline-block; width:6px; height:6px; border-radius:3px; background:var(--brand); opacity:0.5; animation:status-pulse 1s ease-in-out infinite; }
.msg-status .sending-label { color:var(--text-secondary); font-size:12px; font-weight:500; }
.msg-status .sending-label { animation:sending-label-hide 0s linear 8s forwards; }
.msg-status .still-sending-label { display:none; color:var(--text-secondary); font-size:12px; font-weight:500; animation:still-sending-label-show 0s linear 8s forwards; }
.msg-status.sending-status { visibility:hidden; animation:status-reveal 0s linear 350ms forwards; }
.msg-status .queued-label { color:var(--text-secondary); font-size:12px; font-weight:500; }
.msg-status .queued-edit { color:var(--brand); cursor:pointer; font-size:12px; }
.msg-status .queued-delete { color:var(--error); cursor:pointer; font-size:12px; }
.msg-status .sent { color:var(--success); }
.msg-status .error-resend { color:var(--error); cursor:pointer; font-size:12px; border:0; background:transparent; padding:0; }
.msg-status .ephemeral-error { color:var(--error); font-size:12px; }
.msg-status .uncertain-resend { color:var(--warning); cursor:pointer; font-size:12px; border:0; background:transparent; padding:0; }
.user-wrap, .agent-wrap { position:relative; }
.msg-copy-btn {
  display:none; position:fixed; top:0; left:0; z-index:20; min-height:44px;
  padding:9px 16px; border:1px solid var(--border); border-radius:10px;
  background:var(--surface); color:var(--text); font-size:14px; line-height:20px;
  font-weight:500; white-space:nowrap; cursor:pointer; -webkit-tap-highlight-color:transparent;
  box-shadow:0 6px 24px rgba(0,0,0,0.14);
}
.msg-row.msg-actions-open .msg-copy-btn { display:block; }
.msg-copy-btn:active { background:var(--surface-hover); }
@keyframes status-pulse {
  0%,100% { opacity:0.35; transform:scale(0.9); }
  50% { opacity:1; transform:scale(1); }
}
@keyframes status-reveal { to { visibility:visible; } }
@keyframes sending-label-hide { to { display:none; } }
@keyframes still-sending-label-show { to { display:inline; } }

.agent-wrap { max-width:100%; }
.bubble-agent { background:transparent; border-radius:0; padding:4px 0; word-break:break-word; }
.bubble-agent-error { border:1px solid var(--error); background:color-mix(in srgb, var(--error) 8%, var(--surface)); }
.agent-error-label { margin-top:8px; font-size:11px; color:var(--error); opacity:0.85; }
.approval-card {
  margin:6px 0; padding:12px 14px; border-radius:14px;
  border:1px solid color-mix(in srgb, var(--warning) 45%, var(--border));
  background:color-mix(in srgb, var(--warning) 10%, var(--surface));
  box-shadow:0 8px 24px rgba(0,0,0,0.06);
}
.approval-card-kicker {
  display:inline-flex; align-items:center; gap:6px; margin-bottom:5px;
  color:var(--warning); font-size:11px; line-height:16px; font-weight:700; letter-spacing:0.02em;
}
.approval-card-kicker::before { content:'!'; display:inline-flex; align-items:center; justify-content:center; width:16px; height:16px; border-radius:50%; background:var(--warning); color:#fff; font-size:11px; }
.approval-card-title { color:var(--text); font-size:15px; line-height:22px; font-weight:700; margin-bottom:4px; }
.approval-card-content { color:var(--text); font-size:14px; line-height:21px; white-space:pre-wrap; overflow-wrap:anywhere; }
.approval-card-hint { margin-top:8px; color:var(--text-secondary); font-size:12px; line-height:18px; }
.delivery-card {
  margin:6px 0; padding:12px 14px; border-radius:12px;
  border:1px solid color-mix(in srgb, var(--warning) 36%, var(--border));
  background:color-mix(in srgb, var(--warning) 8%, var(--surface));
}
.delivery-kicker {
  color:var(--warning); font-size:11px; line-height:16px; font-weight:700; margin-bottom:5px;
}
.delivery-title { color:var(--text); font-size:15px; line-height:22px; font-weight:700; }
.delivery-detail { margin-top:6px; color:var(--text-secondary); font-size:13px; line-height:19px; white-space:pre-wrap; overflow-wrap:anywhere; }
.delivery-original-label { margin-top:10px; color:var(--text-secondary); font-size:11px; line-height:16px; font-weight:700; }
.delivery-original {
  margin-top:5px; padding:8px 10px; border-radius:8px;
  background:var(--surface-hover); color:var(--text); font-size:13px; line-height:19px;
  white-space:pre-wrap; overflow-wrap:anywhere; word-break:break-word;
}
.delivery-copy-btn {
  margin-top:8px; padding:5px 10px; border:1px solid var(--border); border-radius:8px;
  background:var(--surface); color:var(--text); font-size:12px; line-height:16px; font-weight:700;
}
.delivery-inline {
  display:inline-flex; align-items:center; gap:6px; margin-top:6px; padding:4px 9px;
  border:1px solid color-mix(in srgb, var(--warning) 28%, var(--border)); border-radius:999px;
  color:var(--text-secondary); background:color-mix(in srgb, var(--warning) 7%, var(--surface));
  font-size:12px; line-height:16px; max-width:100%;
}
.delivery-inline-dot {
  width:6px; height:6px; border-radius:50%; background:var(--warning); flex:0 0 auto;
}

.thinking-block { margin-bottom:4px; }
.thinking-block summary {
  padding:4px 0; font-size:13px; color:var(--text-tertiary); cursor:pointer;
  list-style:none; display:inline-flex; align-items:center; gap:4px;
  user-select:none; -webkit-tap-highlight-color:transparent;
}
.thinking-block summary::before { content:'›'; font-size:15px; font-weight:300; display:inline-block; transition:transform 0.15s; }
.thinking-block[open] summary::before { transform:rotate(90deg); }
.thinking-block .thinking-content {
  padding:6px 12px; margin:2px 0 6px; font-size:13px; line-height:20px;
  color:var(--text-tertiary); border-left:2px solid var(--border); white-space:pre-wrap;
}

.tool-disclosure { margin:0; }
.tool-disclosure summary {
  padding:0; font-size:13px; color:var(--text-tertiary); cursor:pointer;
  line-height:19px; list-style:none; display:flex; align-items:center; gap:8px;
  user-select:none; -webkit-tap-highlight-color:transparent;
}
.tool-disclosure summary::-webkit-details-marker { display:none; }
.tool-disclosure .tool-summary { min-width:0; flex:1; display:flex; align-items:baseline; gap:8px; overflow:hidden; }
.tool-disclosure .tool-title { font-weight:400; color:var(--text-tertiary); line-height:19px; flex-shrink:0; }
.tool-disclosure > summary,
.tool-disclosure > summary .tool-title { font-size:15px; line-height:22px; }
.tool-disclosure .tool-meta {
  color:var(--text-tertiary); font-size:12px; overflow:hidden; text-overflow:ellipsis;
  white-space:nowrap; min-width:0; font-family:'SF Mono','Menlo','Consolas',monospace;
}
.tool-disclosure .tool-status-running { display:inline-flex; align-items:center; gap:2px; flex-shrink:0; margin-left:auto; padding-top:4px; }
.tool-disclosure .tool-status-running span { width:4px; height:4px; border-radius:50%; background:var(--text-tertiary); animation:tool-pulse 1.4s infinite ease-in-out; }
.tool-disclosure .tool-status-running span:nth-child(2) { animation-delay:0.2s; }
.tool-disclosure .tool-status-running span:nth-child(3) { animation-delay:0.4s; }
@keyframes tool-pulse {
  0%,60%,100% { opacity:0.3; transform:scale(0.8); }
  30% { opacity:1; transform:scale(1.1); }
}
.tool-disclosure .tool-content,
.tool-disclosure .tool-group-content {
  margin-top:0; margin-left:11px; padding:2px 0 0 12px; border-left:1px solid var(--border);
}
.tool-disclosure .tool-section { margin-bottom:8px; }
.tool-disclosure .tool-section:last-child { margin-bottom:0; }
.tool-disclosure .tool-label { display:block; font-size:9px; font-weight:600; text-transform:uppercase; color:var(--text-tertiary); margin-bottom:4px; }
.tool-disclosure .tool-code {
  font-family:'SF Mono','Menlo','Consolas',monospace; font-size:11px; line-height:16px;
  background:var(--surface-hover); border-radius:6px; padding:8px; color:var(--text);
  white-space:pre-wrap; word-break:break-word; overflow-wrap:anywhere; overflow-x:hidden;
}
.tool-code-truncated {
  margin-top:4px; font-size:11px; line-height:16px; color:var(--text-tertiary);
}
.tool-detail-hint {
  margin:4px 0 8px; font-size:11px; line-height:16px; color:var(--text-tertiary);
}
.tool-group .tool-group-item { padding:6px 0 8px; border-bottom:1px solid var(--border); }
.tool-group .tool-group-item:last-child { border-bottom:none; padding-bottom:2px; }
.tool-group .tool-group-item-header { display:flex; align-items:center; gap:8px; min-width:0; list-style:none; cursor:pointer; }
.tool-group .tool-group-item-header::-webkit-details-marker { display:none; }
.tool-group .tool-group-item-header::after { content:'⋯'; margin-left:auto; color:var(--text-tertiary); font-size:14px; line-height:1; flex-shrink:0; }
.tool-group .tool-group-item-body { padding-top:6px; }
.tool-group-more { width:100%; margin-top:7px; padding:8px 10px; border:0; border-radius:8px; background:var(--surface-hover); color:var(--text-secondary); font:inherit; cursor:pointer; }
.md-streaming-plain { white-space:pre-wrap; overflow-wrap:anywhere; }
.tool-group .tool-item-label { font-size:13px; line-height:19px; font-weight:400; color:var(--text-tertiary); flex-shrink:0; }
.tool-group .tool-item-meta {
  color:var(--text-tertiary); font-size:12px; overflow:hidden; text-overflow:ellipsis;
  white-space:nowrap; min-width:0; font-family:'SF Mono','Menlo','Consolas',monospace;
}

.process-collapse { margin:10px 0 6px; padding:0 16px; }
.process-collapse summary {
  display:inline-flex; align-items:center; gap:6px; list-style:none; cursor:pointer;
  color:var(--text-secondary); font-size:15px; line-height:22px;
  user-select:none; -webkit-tap-highlight-color:transparent;
}
.process-collapse summary::-webkit-details-marker { display:none; }
.process-collapse summary::after {
  content:'›'; font-size:18px; line-height:18px; font-weight:300;
  transition:transform 0.15s ease;
}
.process-collapse[open] summary::after { transform:rotate(90deg); }
.process-collapse-content {
  margin:8px 0 4px; padding:2px 0 2px 10px;
  border-left:1px solid var(--border);
}
.process-collapse-content .msg-row { padding-left:0; padding-right:0; }

.typing-row { padding:4px 16px; }
.typing-bubble { display:inline-flex; align-items:center; gap:4px; background:var(--surface); border-radius:12px 12px 12px 4px; padding:8px 10px; }
.typing-bubble .dot { width:5px; height:5px; border-radius:50%; background:var(--text-tertiary); animation:bounce 1.2s infinite ease-in-out; }
.typing-bubble .dot:nth-child(2) { animation-delay:0.15s; }
.typing-bubble .dot:nth-child(3) { animation-delay:0.3s; }
@media (prefers-reduced-motion: reduce) { .typing-bubble .dot { animation:none; } }
@keyframes bounce {
  0%,60%,100% { transform:translateY(0); }
  30% { transform:translateY(-6px); }
}

.bubble-agent .md {
  font-size:15px; line-height:23px; color:var(--text);
  overflow-wrap:anywhere; word-break:break-word;
}
.bubble-agent .md > *:first-child { margin-top:0; }
.bubble-agent .md > *:last-child { margin-bottom:0; }
.bubble-agent .md h1, .bubble-agent .md h2, .bubble-agent .md h3,
.bubble-agent .md h4, .bubble-agent .md h5, .bubble-agent .md h6 {
  font-size:1em; font-weight:600; margin:1em 0 0.4em; line-height:1.45;
  overflow-wrap:anywhere; word-break:break-word;
}
.bubble-agent .md p { margin:0.5em 0; }
.bubble-agent .md strong { font-weight:600; }
.bubble-agent .md code:not(pre code) {
  display:inline; background:var(--surface); border:0; border-radius:3px; padding:0 0.2em;
  font-family:'SF Mono','Menlo','Consolas',monospace; font-size:0.9em; line-height:inherit; color:var(--text);
  white-space:normal; overflow-wrap:anywhere; word-break:break-word;
  -webkit-box-decoration-break:clone; box-decoration-break:clone;
}
.bubble-agent .md pre { margin:8px 0; border-radius:8px; overflow:hidden; max-width:100%; }
.bubble-agent .md blockquote { border-left:3px solid var(--border); padding-left:12px; margin:8px 0; opacity:0.85; }
.bubble-agent .md ul, .bubble-agent .md ol { padding-left:1.35em; margin:0.5em 0; list-style-position:outside; }
.bubble-agent .md li { margin:0.35em 0; padding-left:0.15em; }
.bubble-agent .md li > p { margin:0.2em 0; }
.bubble-agent .md li > ul, .bubble-agent .md li > ol { margin:0.25em 0; padding-left:1.25em; }
.bubble-agent .md li::marker { color:var(--text-secondary); font-weight:400; }
.bubble-agent .md a { color:var(--brand); text-decoration:none; }
.bubble-agent .md a:hover { text-decoration:underline; }
.bubble-agent .md hr { border:none; border-top:1px solid var(--border); margin:10px 0; }
.bubble-agent .md table { border-collapse:collapse; margin:8px 0; font-size:13px; width:100%; table-layout:fixed; }
.bubble-agent .md th, .bubble-agent .md td {
  border:1px solid var(--border); padding:6px 10px; text-align:left;
  vertical-align:top; word-break:break-word; overflow-wrap:anywhere;
}
.bubble-agent .md th { background:var(--surface-hover); font-weight:600; }
.bubble-agent .md img { max-width:100%; border-radius:8px; }

.code-block-wrap { position:relative; margin:8px 0; border-radius:8px; overflow:hidden; border:1px solid var(--border); background:var(--surface-hover); max-width:100%; }
.code-block-header { display:flex; justify-content:space-between; align-items:center; gap:8px; padding:6px 10px; background:var(--surface); border-bottom:1px solid var(--border); font-size:10px; }
.code-block-lang {
  font-weight:600; color:var(--text-tertiary); text-transform:uppercase; font-family:'SF Mono',Menlo,Consolas,monospace;
  min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
}
.code-block-copy { padding:2px 8px; border:none; border-radius:4px; background:var(--surface-hover); color:var(--text-secondary); font-size:10px; font-weight:600; cursor:pointer; flex-shrink:0; }
.code-block-copy:active { opacity:0.7; }
.code-block-wrap pre {
  margin:0; padding:12px; overflow-x:hidden; white-space:pre-wrap; word-break:break-word; overflow-wrap:anywhere;
  font-family:'SF Mono',Menlo,Consolas,monospace; font-size:12px; line-height:18px; color:var(--text);
}
.code-block-wrap code { font-family:inherit; font-size:inherit; background:none; padding:0; border-radius:0; }

/* Streaming caret */
.streaming-caret {
  display:inline-block; width:2px; height:1em; background:var(--brand);
  margin-left:2px; vertical-align:text-bottom; animation:caret-blink 0.8s steps(2) infinite;
}
@keyframes caret-blink { 0%,100% { opacity:1; } 50% { opacity:0; } }
`

/** CSS injected into the web renderer. Scoped under .cwv to avoid leaking into host app. */
export const CHAT_CSS_WEB = `
.cwv {
  font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',Roboto,Helvetica,Arial,sans-serif;
  font-size:14px; line-height:1.5; -webkit-font-smoothing:antialiased;
}
.cwv .cwv-empty { display:flex; align-items:center; justify-content:center; min-height:100%; padding:40px 20px; }
.cwv .cwv-empty-text { font-size:14px; color:var(--text-tertiary); }
.cwv .cwv-messages { max-width:860px; margin:0 auto; width:100%; }
.cwv-desktop .cwv-empty {
  box-sizing:border-box; max-width:860px; margin:0 auto; padding:56px 24px 88px; text-align:center;
}
.cwv-desktop .cwv-messages { box-sizing:border-box; padding:20px 0 28px!important; }
.cwv .time-separator { display:flex; justify-content:center; padding:8px 0; }
.cwv .time-separator span { font-size:11px; color:var(--text-tertiary); }
.cwv .msg-row { padding:4px 16px; }
${workerCardCss('.cwv ')}
.cwv .msg-row.msg-tool { padding-top:8px; padding-bottom:1px; }
.cwv .msg-user { display:flex; flex-direction:column; justify-content:flex-end; align-items:flex-end; gap:0; }
.cwv .msg-agent { display:flex; flex-direction:column; }
.cwv .user-wrap { display:flex; flex-direction:column; align-items:flex-end; max-width:80%; }
.cwv .ref-tag { color:var(--brand); font-weight:500; }
.cwv-dark .ref-tag { color:var(--brand); }
.cwv .bubble-user {
  background:var(--own-message); border-radius:18px 18px 6px 18px;
  padding:10px 16px; color:var(--text); font-size:14px; line-height:20px;
  overflow-wrap:break-word; white-space:pre-wrap;
}
.cwv .bubble-user.error { opacity:0.7; }
.cwv .bubble-user .md {
  font-size:14px; line-height:20px; color:var(--text); white-space:normal;
  overflow-wrap:anywhere; word-break:break-word;
}
.cwv .bubble-user .md > *:first-child { margin-top:0; }
.cwv .bubble-user .md > *:last-child { margin-bottom:0; }
.cwv .bubble-user .md p { margin:4px 0; }
.cwv .bubble-user .md p:first-child { margin-top:0; }
.cwv .bubble-user .md p:last-child { margin-bottom:0; }
.cwv .bubble-user .md h1, .cwv .bubble-user .md h2, .cwv .bubble-user .md h3,
.cwv .bubble-user .md h4, .cwv .bubble-user .md h5, .cwv .bubble-user .md h6 {
  font-size:14px; line-height:20px; font-weight:700; margin:6px 0 4px;
  overflow-wrap:anywhere; word-break:break-word;
}
.cwv .bubble-user .md ul, .cwv .bubble-user .md ol {
  margin:6px 0; padding-left:20px; list-style-position:outside;
}
.cwv .bubble-user .md li { margin:4px 0; padding-left:2px; }
.cwv .bubble-user .md li > p { margin:0; }
.cwv .bubble-user .md li::marker {
  color:color-mix(in srgb, var(--text) 72%, transparent);
  font-weight:600;
}
.cwv .bubble-user .md code:not(pre code) {
  background:color-mix(in srgb, var(--text) 10%, transparent);
  border-radius:6px; padding:2px 6px;
  font-family:'SF Mono','Menlo','Consolas',monospace;
  font-size:0.88em; line-height:1.6; color:var(--text);
  -webkit-box-decoration-break:clone; box-decoration-break:clone;
  overflow-wrap:anywhere; word-break:break-word;
}
.cwv .bubble-user .md blockquote {
  margin:6px 0; padding-left:12px; border-left:3px solid color-mix(in srgb, var(--text) 16%, transparent);
  color:color-mix(in srgb, var(--text) 84%, transparent);
}
.cwv .bubble-user .md a { color:var(--brand); text-decoration:none; }
.cwv .bubble-user .md a:hover { text-decoration:underline; }
.cwv .resource-line-label { margin-left:4px; color:var(--text-tertiary); font-size:0.9em; white-space:nowrap; }
.cwv .user-attachments { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:8px; }
.cwv .attachment-thumb-btn,
.cwv .attachment-file-card,
.cwv .resource-pill {
  border:none; background:none; padding:0; color:inherit; cursor:pointer;
}
.cwv .attachment-image-actions { position:relative; display:inline-flex; max-width:240px; }
.cwv .attachment-thumb-btn { border-radius:12px; overflow:hidden; max-width:240px; }
.cwv .attachment-thumb {
  display:block; width:100%; max-width:240px; max-height:240px; object-fit:cover;
  border-radius:12px; background:var(--surface-hover);
}
.cwv .attachment-thumb-fallback {
  width:120px; height:90px; border-radius:12px;
  background:var(--surface); border:1px solid var(--border);
  display:none; align-items:center; justify-content:center; gap:4px;
  flex-direction:column;
}
.cwv .attachment-image-placeholder {
  width:120px; height:90px; border-radius:12px; overflow:hidden;
  background:var(--surface); border:1px solid var(--border);
  display:flex; align-items:center; justify-content:center; gap:4px;
  flex-direction:column; cursor:pointer;
}
.cwv .attachment-image-placeholder .placeholder-icon { font-size:24px; line-height:1; opacity:0.5; }
.cwv .attachment-image-placeholder .placeholder-label {
  font-size:10px; color:var(--text-tertiary); max-width:100px;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; text-align:center; padding:0 8px;
}
.cwv .attachment-actions-btn {
  position:absolute; top:6px; right:6px; width:32px; height:32px; padding:0;
  display:flex; align-items:center; justify-content:center; border:1px solid var(--border);
  border-radius:9px; background:var(--surface); color:var(--text); font-size:20px;
  line-height:20px; cursor:pointer; opacity:0; pointer-events:none;
  box-shadow:0 2px 8px rgba(0,0,0,0.12); transition:opacity 0.12s ease;
}
.cwv .attachment-image-actions:hover .attachment-actions-btn,
.cwv .attachment-image-actions:focus-within .attachment-actions-btn,
.cwv .attachment-actions-btn:focus-visible {
  opacity:1; pointer-events:auto;
}
.cwv .attachment-actions-btn:hover,
.cwv .attachment-actions-btn:focus-visible { background:var(--surface-hover); }
.cwv .attachment-file-card {
  display:flex; align-items:center; gap:8px; max-width:220px;
  padding:10px 12px; border-radius:12px; background:var(--surface);
  border:1px solid var(--border); text-align:left;
}
.cwv .attachment-file-icon { font-size:16px; line-height:1; }
.cwv .attachment-file-name {
  font-size:13px; line-height:18px; color:var(--text);
  word-break:break-word;
}
.cwv .resource-pill {
  display:inline-flex; align-items:center; gap:6px;
  margin:4px 0; padding:8px 10px; border-radius:10px;
  background:var(--surface); border:1px solid var(--border);
  color:var(--brand); font-size:13px; line-height:18px;
}
.cwv .resource-pill-image::before { content:'🖼'; }
.cwv .msg-status { display:flex; align-items:center; justify-content:flex-end; gap:4px; font-size:12px; line-height:17px; padding:4px 4px 2px; flex-shrink:0; }
.cwv .msg-status .sending { display:inline-block; width:6px; height:6px; border-radius:3px; background:var(--brand); opacity:0.5; animation:status-pulse 1s ease-in-out infinite; }
.cwv .msg-status .sending-label { color:var(--text-secondary); font-size:12px; font-weight:500; }
.cwv .msg-status .sending-label { animation:sending-label-hide 0s linear 8s forwards; }
.cwv .msg-status .still-sending-label { display:none; color:var(--text-secondary); font-size:12px; font-weight:500; animation:still-sending-label-show 0s linear 8s forwards; }
.cwv .msg-status.sending-status { visibility:hidden; animation:status-reveal 0s linear 350ms forwards; }
.cwv .msg-status .queued-label { color:var(--text-secondary); font-size:12px; font-weight:500; }
.cwv .msg-status .queued-edit { color:var(--brand); cursor:pointer; font-size:12px; }
.cwv .msg-status .queued-delete { color:var(--error); cursor:pointer; font-size:12px; }
.cwv .msg-status .sent { color:var(--success); }
.cwv .msg-status .error-resend { color:var(--error); cursor:pointer; font-size:12px; border:0; background:transparent; padding:0; }
.cwv .msg-status .ephemeral-error { color:var(--error); font-size:12px; }
.cwv .msg-status .uncertain-resend { color:var(--warning); cursor:pointer; font-size:12px; border:0; background:transparent; padding:0; }
@keyframes status-pulse {
  0%,100% { opacity:0.35; transform:scale(0.9); }
  50% { opacity:1; transform:scale(1); }
}
@keyframes status-reveal { to { visibility:visible; } }
@keyframes sending-label-hide { to { display:none; } }
@keyframes still-sending-label-show { to { display:inline; } }
.cwv .msg-copy-btn {
  align-self:flex-start; margin-top:2px; padding:2px 8px; border:0; border-radius:999px;
  background:transparent; color:var(--text-tertiary); font-size:11px; line-height:16px;
  cursor:pointer; opacity:0; transition:opacity 0.12s ease, background 0.12s ease, color 0.12s ease;
}
.cwv .user-wrap .msg-copy-btn { align-self:flex-end; }
.cwv .msg-row:hover .msg-copy-btn,
.cwv .msg-copy-btn:focus-visible,
.cwv .msg-copy-btn:active {
  opacity:1;
}
.cwv .msg-copy-btn:hover,
.cwv .msg-copy-btn:focus-visible,
.cwv .msg-copy-btn:active {
  background:var(--surface-hover); color:var(--text-secondary);
}
.cwv .agent-wrap { max-width:100%; }
.cwv .bubble-agent { background:transparent; border-radius:0; padding:4px 0; word-break:break-word; }
.cwv .approval-card {
  margin:6px 0; padding:12px 14px; border-radius:14px;
  border:1px solid color-mix(in srgb, var(--warning) 45%, var(--border));
  background:color-mix(in srgb, var(--warning) 10%, var(--surface));
  box-shadow:0 8px 24px rgba(0,0,0,0.06);
}
.cwv .approval-card-kicker {
  display:inline-flex; align-items:center; gap:6px; margin-bottom:5px;
  color:var(--warning); font-size:11px; line-height:16px; font-weight:700; letter-spacing:0.02em;
}
.cwv .approval-card-kicker::before { content:'!'; display:inline-flex; align-items:center; justify-content:center; width:16px; height:16px; border-radius:50%; background:var(--warning); color:#fff; font-size:11px; }
.cwv .approval-card-title { color:var(--text); font-size:15px; line-height:22px; font-weight:700; margin-bottom:4px; }
.cwv .approval-card-content { color:var(--text); font-size:14px; line-height:21px; white-space:pre-wrap; overflow-wrap:anywhere; }
.cwv .approval-card-hint { margin-top:8px; color:var(--text-secondary); font-size:12px; line-height:18px; }
.cwv .delivery-card {
  margin:6px 0; padding:12px 14px; border-radius:12px;
  border:1px solid color-mix(in srgb, var(--warning) 36%, var(--border));
  background:color-mix(in srgb, var(--warning) 8%, var(--surface));
}
.cwv .delivery-kicker {
  color:var(--warning); font-size:11px; line-height:16px; font-weight:700; margin-bottom:5px;
}
.cwv .delivery-title { color:var(--text); font-size:15px; line-height:22px; font-weight:700; }
.cwv .delivery-detail { margin-top:6px; color:var(--text-secondary); font-size:13px; line-height:19px; white-space:pre-wrap; overflow-wrap:anywhere; }
.cwv .delivery-original-label { margin-top:10px; color:var(--text-secondary); font-size:11px; line-height:16px; font-weight:700; }
.cwv .delivery-original {
  margin-top:5px; padding:8px 10px; border-radius:8px;
  background:var(--surface-hover); color:var(--text); font-size:13px; line-height:19px;
  white-space:pre-wrap; overflow-wrap:anywhere; word-break:break-word;
}
.cwv .delivery-copy-btn {
  margin-top:8px; padding:5px 10px; border:1px solid var(--border); border-radius:8px;
  background:var(--surface); color:var(--text); font-size:12px; line-height:16px; font-weight:700;
  cursor:pointer;
}
.cwv .delivery-copy-btn:hover,
.cwv .delivery-copy-btn:focus-visible { background:var(--surface-hover); }
.cwv .delivery-inline {
  display:inline-flex; align-items:center; gap:6px; margin-top:6px; padding:4px 9px;
  border:1px solid color-mix(in srgb, var(--warning) 28%, var(--border)); border-radius:999px;
  color:var(--text-secondary); background:color-mix(in srgb, var(--warning) 7%, var(--surface));
  font-size:12px; line-height:16px; max-width:100%;
}
.cwv .delivery-inline-dot {
  width:6px; height:6px; border-radius:50%; background:var(--warning); flex:0 0 auto;
}
.cwv .thinking-block { margin-bottom:4px; }
.cwv .thinking-block summary {
  padding:4px 0; font-size:13px; color:var(--text-tertiary); cursor:pointer;
  list-style:none; display:inline-flex; align-items:center; gap:4px; user-select:none;
}
.cwv .thinking-block summary::before { content:'›'; font-size:15px; font-weight:300; transition:transform 0.15s; display:inline-block; }
.cwv .thinking-block[open] summary::before { transform:rotate(90deg); }
.cwv .thinking-block .thinking-content {
  padding:6px 12px; margin:2px 0 6px; font-size:13px; line-height:20px; color:var(--text-tertiary);
  border-left:2px solid var(--border); white-space:pre-wrap;
}
.cwv .tool-disclosure { margin:0; }
.cwv .tool-disclosure summary {
  padding:0; font-size:13px; color:var(--text-tertiary); cursor:pointer;
  line-height:19px; list-style:none; display:flex; align-items:center; gap:8px; user-select:none;
}
.cwv .tool-disclosure summary::-webkit-details-marker { display:none; }
.cwv .tool-disclosure .tool-summary { min-width:0; flex:1; display:flex; align-items:baseline; gap:8px; overflow:hidden; }
.cwv .tool-disclosure .tool-title { font-weight:400; color:var(--text-tertiary); line-height:19px; flex-shrink:0; }
.cwv .tool-disclosure > summary,
.cwv .tool-disclosure > summary .tool-title { font-size:15px; line-height:22px; }
.cwv .tool-disclosure .tool-meta {
  color:var(--text-tertiary); font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  min-width:0; font-family:'SF Mono','Menlo','Consolas',monospace;
}
.cwv .tool-disclosure .tool-status-running { display:inline-flex; align-items:center; gap:2px; flex-shrink:0; margin-left:auto; padding-top:4px; }
.cwv .tool-disclosure .tool-status-running span { width:4px; height:4px; border-radius:50%; background:var(--text-tertiary); animation:cwv-tool-pulse 1.4s infinite ease-in-out; }
.cwv .tool-disclosure .tool-status-running span:nth-child(2) { animation-delay:0.2s; }
.cwv .tool-disclosure .tool-status-running span:nth-child(3) { animation-delay:0.4s; }
@keyframes cwv-tool-pulse {
  0%,60%,100% { opacity:0.3; transform:scale(0.8); }
  30% { opacity:1; transform:scale(1.1); }
}
.cwv .tool-disclosure .tool-content,
.cwv .tool-disclosure .tool-group-content {
  margin-top:0; margin-left:11px; padding:2px 0 0 12px; border-left:1px solid var(--border);
}
.cwv .tool-disclosure .tool-section { margin-bottom:8px; }
.cwv .tool-disclosure .tool-section:last-child { margin-bottom:0; }
.cwv .tool-disclosure .tool-label { display:block; font-size:9px; font-weight:600; text-transform:uppercase; color:var(--text-tertiary); margin-bottom:4px; }
.cwv .tool-disclosure .tool-code {
  font-family:'SF Mono','Menlo','Consolas',monospace; font-size:11px; line-height:16px;
  background:var(--surface-hover); border-radius:6px; padding:8px; color:var(--text);
  white-space:pre-wrap; word-break:break-all; overflow-x:auto;
}
.cwv .tool-code-truncated {
  margin-top:4px; font-size:11px; line-height:16px; color:var(--text-tertiary);
}
.cwv .tool-detail-hint {
  margin:4px 0 8px; font-size:11px; line-height:16px; color:var(--text-tertiary);
}
.cwv .tool-group .tool-group-item { padding:6px 0 8px; border-bottom:1px solid var(--border); }
.cwv .tool-group .tool-group-item:last-child { border-bottom:none; padding-bottom:2px; }
.cwv .tool-group .tool-group-item-header { display:flex; align-items:center; gap:8px; min-width:0; list-style:none; cursor:pointer; }
.cwv .tool-group .tool-group-item-header::-webkit-details-marker { display:none; }
.cwv .tool-group .tool-group-item-header::after { content:'⋯'; margin-left:auto; color:var(--text-tertiary); font-size:14px; line-height:1; flex-shrink:0; }
.cwv .tool-group .tool-group-item-body { padding-top:6px; }
.cwv .tool-group-more { width:100%; margin-top:7px; padding:8px 10px; border:0; border-radius:8px; background:var(--surface-hover); color:var(--text-secondary); font:inherit; cursor:pointer; }
.cwv .md-streaming-plain { white-space:pre-wrap; overflow-wrap:anywhere; }
.cwv .tool-group .tool-item-label { font-size:13px; line-height:19px; font-weight:400; color:var(--text-tertiary); flex-shrink:0; }
.cwv .tool-group .tool-item-meta {
  color:var(--text-tertiary); font-size:12px; overflow:hidden; text-overflow:ellipsis;
  white-space:nowrap; min-width:0; font-family:'SF Mono','Menlo','Consolas',monospace;
}
.cwv .process-collapse { margin:10px 0 6px; padding:0 16px; }
.cwv .process-collapse summary {
  display:inline-flex; align-items:center; gap:6px; list-style:none; cursor:pointer;
  color:var(--text-secondary); font-size:15px; line-height:22px; user-select:none;
}
.cwv .process-collapse summary::-webkit-details-marker { display:none; }
.cwv .process-collapse summary::after {
  content:'›'; font-size:18px; line-height:18px; font-weight:300;
  transition:transform 0.15s ease;
}
.cwv .process-collapse[open] summary::after { transform:rotate(90deg); }
.cwv .process-collapse-content {
  margin:8px 0 4px; padding:2px 0 2px 10px; border-left:1px solid var(--border);
}
.cwv .process-collapse-content .msg-row { padding-left:0; padding-right:0; }
.cwv .typing-row { padding:4px 16px; }
.cwv .typing-bubble { display:inline-flex; align-items:center; gap:4px; background:var(--surface); border-radius:12px 12px 12px 4px; padding:8px 10px; }
.cwv .typing-bubble .dot { width:5px; height:5px; border-radius:50%; background:var(--text-tertiary); animation:cwv-bounce 1.2s infinite ease-in-out; }
.cwv .typing-bubble .dot:nth-child(2) { animation-delay:0.15s; }
.cwv .typing-bubble .dot:nth-child(3) { animation-delay:0.3s; }
@media (prefers-reduced-motion: reduce) { .cwv .typing-bubble .dot { animation:none; } }
@keyframes cwv-bounce {
  0%,60%,100% { transform:translateY(0); }
  30% { transform:translateY(-6px); }
}
.cwv .bubble-agent .md {
  font-size:14px; line-height:22px; color:var(--text);
  overflow-wrap:anywhere; word-break:break-word;
}
.cwv .bubble-agent .md > *:first-child { margin-top:0; }
.cwv .bubble-agent .md > *:last-child { margin-bottom:0; }
.cwv .bubble-agent .md h1, .cwv .bubble-agent .md h2, .cwv .bubble-agent .md h3,
.cwv .bubble-agent .md h4, .cwv .bubble-agent .md h5, .cwv .bubble-agent .md h6 {
  font-size:1em; font-weight:600; margin:1em 0 0.4em; line-height:1.45;
  overflow-wrap:anywhere; word-break:break-word;
}
.cwv .bubble-agent .md p { margin:0.5em 0; }
.cwv .bubble-agent .md strong { font-weight:600; }
.cwv .bubble-agent .md code:not(pre code) {
  display:inline; background:var(--surface); border:0; border-radius:3px; padding:0 0.2em;
  font-family:'SF Mono','Menlo','Consolas',monospace; font-size:0.9em; line-height:inherit; color:var(--text);
  white-space:normal; overflow-wrap:anywhere; word-break:break-word;
  -webkit-box-decoration-break:clone; box-decoration-break:clone;
}
.cwv .code-block-wrap code { background:none !important; padding:0 !important; border:0 !important; border-radius:0 !important; font-family:inherit; font-size:inherit; }
.cwv .bubble-agent .md pre { margin:8px 0; border-radius:8px; overflow:hidden; }
.cwv .bubble-agent .md blockquote { border-left:3px solid var(--border); padding-left:12px; margin:8px 0; opacity:0.85; }
.cwv .bubble-agent .md ul, .cwv .bubble-agent .md ol { padding-left:1.35em; margin:0.5em 0; list-style-position:outside; }
.cwv .bubble-agent .md li { margin:0.35em 0; padding-left:0.15em; }
.cwv .bubble-agent .md li > p { margin:0.2em 0; }
.cwv .bubble-agent .md li > ul, .cwv .bubble-agent .md li > ol { margin:0.25em 0; padding-left:1.25em; }
.cwv .bubble-agent .md li::marker { color:var(--text-secondary); font-weight:400; }
.cwv .bubble-agent .md a { color:var(--brand); text-decoration:none; }
.cwv .bubble-agent .md a:hover { text-decoration:underline; }
.cwv .bubble-agent .md hr { border:none; border-top:1px solid var(--border); margin:10px 0; }
.cwv .bubble-agent .md table { border-collapse:collapse; margin:8px 0; font-size:13px; width:100%; }
.cwv .bubble-agent .md th, .cwv .bubble-agent .md td { border:1px solid var(--border); padding:6px 10px; text-align:left; }
.cwv .bubble-agent .md th { background:var(--surface-hover); font-weight:600; }
.cwv .bubble-agent .md img { max-width:100%; border-radius:8px; }
.cwv .code-block-wrap { position:relative; margin:8px 0; border-radius:8px; overflow:hidden; border:1px solid var(--border); background:var(--surface-hover); }
.cwv .code-block-header { display:flex; justify-content:space-between; align-items:center; gap:8px; padding:6px 10px; background:var(--surface); border-bottom:1px solid var(--border); font-size:10px; }
.cwv .code-block-lang { font-weight:600; color:var(--text-tertiary); text-transform:uppercase; font-family:'SF Mono',Menlo,Consolas,monospace; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.cwv .code-block-copy { padding:2px 8px; border:none; border-radius:4px; background:var(--surface-hover); color:var(--text-secondary); font-size:10px; font-weight:600; cursor:pointer; flex-shrink:0; }
.cwv .code-block-copy:active { opacity:0.7; }
.cwv .code-block-wrap pre { margin:0; padding:12px; overflow-x:auto; font-family:'SF Mono',Menlo,Consolas,monospace; font-size:12px; line-height:18px; color:var(--text); }

@media (max-width: 640px) {
  .cwv .tool-block .tool-code {
    white-space:pre-wrap;
    word-break:break-word;
    overflow-wrap:anywhere;
    overflow-x:hidden;
  }
  .cwv .bubble-agent .md table {
    table-layout:fixed;
  }
  .cwv .bubble-agent .md th,
  .cwv .bubble-agent .md td {
    vertical-align:top;
    word-break:break-word;
    overflow-wrap:anywhere;
  }
  .cwv .code-block-wrap pre {
    overflow-x:hidden;
    white-space:pre-wrap;
    word-break:break-word;
    overflow-wrap:anywhere;
  }
}
`
