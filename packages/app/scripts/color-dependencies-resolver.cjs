// @arch docs/architecture/mobile-navigation.md
// @test packages/app/src/__tests__/color-dependencies-resolver.test.ts
const path = require('node:path')

// Keep CJS color@4 bound to its compatible color-string@1, not the hoisted
// ESM color-string@2. Metro's global hierarchical lookup remains disabled so
// React and native modules retain their existing single identities.
function resolveColorDependencies(context, moduleName) {
  const origin = context.originModulePath.replaceAll('\\', '/')
  if (!/\/node_modules\/(color|color-string|color-convert)\//.test(origin)
    || !['color-string', 'color-convert', 'color-name', 'simple-swizzle'].includes(moduleName)) return null
  return {
    type: 'sourceFile',
    filePath: require.resolve(moduleName, { paths: [path.dirname(context.originModulePath)] }),
  }
}

module.exports = { resolveColorDependencies }
