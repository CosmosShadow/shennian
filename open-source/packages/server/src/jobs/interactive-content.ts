// @arch open-source/docs/server-runtime.md
// @test src/__tests__/interactive-web-worker.test.ts
/** Compatibility hooks for the retired shared HTML worker. Historical rows stay
 * untouched; local applications are developed and served by the owner's Client. */
export function startInteractiveContentJob() { /* no cloud HTML generation */ }
export async function stopInteractiveContentJob() { /* no outstanding jobs */ }
