// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/model-switching.test.ts

import type { BuiltinAgentType, ModelInfo } from '@shennian/wire'
import os from 'node:os'
import { resolveShennianPath } from '../../config/index.js'

export const CACHE_VERSION = 1
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000
export const MODEL_CACHE_PATH = resolveShennianPath('model-cache.json')
export const DISCOVERY_WORKDIR = os.tmpdir()

export type CacheEntry = {
  version?: string
  sourceRevision?: string
  refreshedAt: number
  models: ModelInfo[]
}

export type CacheFile = {
  version: number
  agents: Record<string, CacheEntry>
}

export type DiscoveryContext = {
  serverUrl?: string
  authToken?: string
}

export type ModelDiscoveryFailureCode =
  | 'app_server_unavailable'
  | 'app_server_timeout'
  | 'app_server_rpc_error'
  | 'empty_model_list'

/** An emergency list that is safe to display but must never become authoritative cache data. */
export class ModelDiscoveryFallbackError extends Error {
  constructor(
    readonly agentType: BuiltinAgentType,
    readonly failureCode: ModelDiscoveryFailureCode,
    readonly fallbackModels: ModelInfo[],
  ) {
    super(`Model discovery fell back for ${agentType}: ${failureCode}`)
    this.name = 'ModelDiscoveryFallbackError'
  }
}

export type PtyOptions = {
  startupArgs?: string[]
  readyPatterns: RegExp[]
  closePatterns: RegExp[]
  preOpenPromptPatterns?: RegExp[]
  preOpenPromptInput?: string
  initialDelayMs?: number
  timeoutMs?: number
  scrollAfterOpenMs?: number
  scrollCount?: number
  scrollIntervalMs?: number
}
