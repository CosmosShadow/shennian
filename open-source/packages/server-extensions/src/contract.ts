// @arch ../../../docs/server-extensions.md
// @test __tests__/register.test.ts
import type { FastifyPluginAsync } from 'fastify'

/** Trusted build-time composition only. This interface is not a plugin sandbox. */
export type ServerExtension = Readonly<{
  id: string
  apiVersion: 1
  officialOnly?: boolean
  enabled?: boolean
  routes: FastifyPluginAsync
}>

export type ServerModuleStatus = Readonly<{ available: boolean; enabled: boolean }>
export type ServerModulesResponse = Readonly<{
  schemaVersion: 1
  modules: Readonly<Record<string, ServerModuleStatus>>
}>
