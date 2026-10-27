// @arch docs/engineering/dev-runtime.md
// @test packages/app/src/__tests__/room-browser-proxy.test.ts
const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')
const { createProxyMiddleware } = require('http-proxy-middleware')

const projectRoot = __dirname
const monorepoRoot = path.resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)
const { desktopMetroBlockList } = require('./scripts/desktop-metro-watch.cjs')
config.resolver.blockList = desktopMetroBlockList(
  config.resolver.blockList,
  monorepoRoot,
  process.env.SHENNIAN_DESKTOP_BUILD === '1',
)

config.watchFolders = [monorepoRoot]
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
]
config.resolver.disableHierarchicalLookup = true
config.resolver.unstable_enablePackageExports = true

const { resolveMarkdownEntities } = require('./scripts/markdown-entities-resolver.cjs')
const { resolveColorDependencies } = require('./scripts/color-dependencies-resolver.cjs')
const previousResolver = config.resolver.resolveRequest
config.resolver.resolveRequest = (context, moduleName, platform) =>
  resolveMarkdownEntities(context, moduleName) ??
  resolveColorDependencies(context, moduleName) ??
  (previousResolver ? previousResolver(context, moduleName, platform) : context.resolveRequest(context, moduleName, platform))

const { createRoomBrowserOriginRewriter } = require('./scripts/room-browser-proxy.cjs')
const apiTarget = 'https://shennian.net'
const rewriteRoomOrigin = createRoomBrowserOriginRewriter(apiTarget)

const apiProxy = createProxyMiddleware({
  // Hong Kong/global service is temporarily offline.
  // target: 'https://shennian.ai',
  target: apiTarget,
  changeOrigin: true,
  secure: true,
  ws: true,
  on: { proxyReq: rewriteRoomOrigin, proxyReqWs: rewriteRoomOrigin },
})

const relayProxy = createProxyMiddleware({
  // Hong Kong/global service is temporarily offline.
  // target: 'https://shennian.ai',
  target: 'https://shennian.net',
  changeOrigin: true,
  secure: true,
  ws: true,
})

/** Metro may send long-lived Cache-Control; browsers (esp. Safari) then keep stale bundles. */
function shouldForceNoCache(url) {
  if (!url) return false
  const pathOnly = url.split('?')[0]
  return (
    pathOnly.includes('.bundle') ||
    pathOnly.endsWith('.js') ||
    pathOnly.endsWith('.map') ||
    pathOnly.includes('/hot') ||
    pathOnly.startsWith('/_expo/') ||
    pathOnly.startsWith('/assets/')
  )
}

function patchResponseNoCache(res, req) {
  if (!shouldForceNoCache(req.url)) return
  const origSet = res.setHeader.bind(res)
  res.setHeader = (name, value) => {
    if (String(name).toLowerCase() === 'cache-control') {
      return origSet(
        'Cache-Control',
        'no-store, no-cache, must-revalidate, max-age=0, proxy-revalidate',
      )
    }
    return origSet(name, value)
  }
}

config.server = {
  ...config.server,
  enhanceMiddleware: (middleware) => {
    return (req, res, next) => {
      if (req.url.startsWith('/api')) return apiProxy(req, res, next)
      if (req.url.startsWith('/relay')) return relayProxy(req, res, next)
      patchResponseNoCache(res, req)
      return middleware(req, res, next)
    }
  },
}

module.exports = config
