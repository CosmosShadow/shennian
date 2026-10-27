// @arch docs/features/agent-workspaces.md
// @test src/__tests__/agent-workspace-form.test.ts

import { groupSessionsIntoProjects, sortProjects } from '@shennian/shared'
import type { NianProject, NianSession } from '@shennian/wire'

export function getAgentWorkspaceProjects(sessions: NianSession[], records: NianProject[]) {
  return sortProjects(groupSessionsIntoProjects(sessions, records)).map((project) => ({
    machineId: project.machineId,
    workDir: project.workDir,
    agentType: project.defaultAgentType ?? (project.sessionCount ? project.latestAgentType : null),
    modelId: project.defaultAgentType ? project.defaultModelId : project.latestModelId,
  }))
}

export type AgentWorkspaceProject = ReturnType<typeof getAgentWorkspaceProjects>[number]
