// @arch docs/features/personal-modules.md
// @test packages/app/src/__tests__/personal-modules.test.ts
const path = require('node:path')
// pnpm hoisting can keep markdown-it's compatible entities version nested.
// Metro's disabled hierarchical lookup must not bind it to another major version.
function resolveMarkdownEntities(context, moduleName) {
  if (!moduleName.startsWith('entities/') || !context.originModulePath.replaceAll('\\', '/').includes('/markdown-it/')) return null
  return { type: 'sourceFile', filePath: require.resolve(moduleName, { paths: [path.dirname(context.originModulePath)] }) }
}
module.exports = { resolveMarkdownEntities }
