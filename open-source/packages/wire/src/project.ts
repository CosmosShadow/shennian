// @arch open-source/docs/wire.md
// @test src/__tests__/project-fs.test.ts

import type { AgentType } from './session.js'

export type NianProject = {
  id: string
  machineId: string
  machineName: string
  machineOnline: boolean
  workDir: string
  displayName: string
  defaultAgentType?: AgentType | null
  defaultModelId?: string | null
  lastActivityAt: string
  createdAt: string
  updatedAt: string
  /** Server-minted opaque reference for project-scoped file RPCs. */
  fileBrowserRef?: string
}
