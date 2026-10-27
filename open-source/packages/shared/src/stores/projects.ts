// @arch open-source/docs/shared-runtime.md
// @test src/__tests__/project-list.test.ts

import { create } from 'zustand'
import type { NianProject } from '@shennian/wire'

type ProjectsState = {
  projects: NianProject[]
  setProjects(projects: NianProject[]): void
  upsertProject(project: NianProject): void
  removeProject(projectId: string): void
}

export const useProjectsStore = create<ProjectsState>((set) => ({
  projects: [],
  setProjects(projects) {
    set({ projects })
  },
  upsertProject(project) {
    set((state) => ({
      projects: [project, ...state.projects.filter((item) => item.id !== project.id)],
    }))
  },
  removeProject(projectId) {
    set((state) => ({ projects: state.projects.filter((project) => project.id !== projectId) }))
  },
}))
