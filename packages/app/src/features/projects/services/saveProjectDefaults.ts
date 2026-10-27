// @arch docs/architecture/launch-config.md
// @test src/__tests__/save-project-defaults.test.ts
import type { NianProject } from '@shennian/wire'
import type { ProjectAccountClient, ProjectDefaults } from '../projectAccountClient.types'

type ProjectTarget = Pick<NianProject, 'id' | 'machineId' | 'workDir'>

/** Session-derived groups may precede the synchronized project record. */
export async function saveProjectDefaults(
  target: ProjectTarget,
  defaults: ProjectDefaults,
  dependencies: {
    createProject: (machineId: string, workDir: string) => Promise<NianProject>
    updateDefaults: ProjectAccountClient['updateDefaults']
  },
): Promise<NianProject> {
  const project = target.id ? target : await dependencies.createProject(target.machineId, target.workDir)
  if (!project.id) throw new Error('Project ID is unavailable')
  return dependencies.updateDefaults(project.id, defaults)
}
