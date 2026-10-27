// @arch docs/architecture/launch-config.md
import { authApi } from '../../config/api'
import type { NianProject } from '@shennian/wire'
import type { ProjectAccountClient } from './projectAccountClient.types'

export const projectAccountClient: ProjectAccountClient = {
  async updateDefaults(projectId, defaults) {
    const result = await authApi<{ project: NianProject }>(
      `/projects/${encodeURIComponent(projectId)}/defaults`,
      { method: 'PATCH', body: JSON.stringify(defaults) },
    )
    return result.project
  },
}
