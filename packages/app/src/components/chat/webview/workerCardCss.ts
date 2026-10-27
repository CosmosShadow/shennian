// @arch docs/features/manager-agent.md#九manager-与-worker-的可见-markdown
// @test src/__tests__/chat-webview-script.test.ts
/** One visual contract for the native WebView and desktop DOM. */
export function workerCardCss(scope = ''): string {
  return `
${scope}.worker-session-card { display:flex; align-items:center; gap:8px; --worker-accent:var(--brand); min-height:44px; padding:10px 12px; border-radius:10px; background:color-mix(in srgb,var(--brand) 7%,var(--bg)); color:var(--text); border:0; text-decoration:none; cursor:pointer; touch-action:manipulation; }
${scope}.worker-session-card[data-worker-kind="completed"] { --worker-accent:color-mix(in srgb,var(--success) 55%,var(--text)); }
${scope}.worker-session-card[data-worker-kind="failed"] { --worker-accent:color-mix(in srgb,var(--error) 70%,var(--text)); }
${scope}.worker-session-card[data-worker-kind="stopped"] { --worker-accent:var(--text-secondary); }
${scope}.worker-card-body { display:block; flex:1; min-width:0; }
${scope}.worker-session-event { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; }
${scope}.worker-session-title { display:block; margin-top:0; color:var(--worker-accent); font-weight:500; line-height:1.45; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
${scope}.worker-session-preview { display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:1; overflow:hidden; margin-top:3px; color:var(--text-secondary); line-height:1.5; white-space:normal; overflow-wrap:anywhere; }
${scope}.worker-event-icon { display:flex; flex:none; width:22px; height:24px; align-items:center; justify-content:center; color:var(--brand); }
${scope}.worker-event-icon svg { display:block; width:20px; height:20px; }
${scope}.worker-event-completed { color:color-mix(in srgb,var(--success) 70%,var(--text)); }
${scope}.worker-event-failed { color:var(--error); }
${scope}.worker-event-stopped { color:var(--text-secondary); }
${scope}.worker-card-chevron { flex:none; align-self:center; color:var(--text-secondary); width:12px; height:12px; }
${scope}.worker-card-chevron svg { display:block; width:100%; height:100%; }
${scope}.worker-session-card:focus-visible { outline:2px solid var(--brand); outline-offset:3px; }
@media (hover:hover) { ${scope}.worker-session-card:hover { background:color-mix(in srgb,var(--brand) 11%,var(--bg)); } }
`
}
