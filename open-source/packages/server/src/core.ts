// @arch open-source/docs/server-runtime.md
// @test src/__tests__/server-extensions.test.ts
/** Public composition API: importing it does not start a listener or load official modules. */
export { buildApp, type BuildAppOptions } from './app.js'
export type { ServerExtension, ServerModulesResponse, ServerModuleStatus } from '@shennian/server-extensions'
