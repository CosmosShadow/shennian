// @arch docs/engineering/dev-runtime.md
// @test packages/app/src/__tests__/room-browser-proxy.test.ts
const path = require('node:path')

/** Keep runtime logs/build evidence out of the Desktop development file map. */
function desktopMetroBlockList(existing, repositoryRoot, desktop) {
  const entries = existing == null ? [] : Array.isArray(existing) ? existing : [existing]
  if (!desktop) return entries
  const runtimeDirectory = path.join(repositoryRoot, '.dev-runtime')
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return [...entries, new RegExp(`^${runtimeDirectory}(?:[/\\\\]|$)`)]
}

module.exports = { desktopMetroBlockList }
