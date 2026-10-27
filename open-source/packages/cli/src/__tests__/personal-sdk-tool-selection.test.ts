// @covers src/personal-agent/sdk-session.ts
import { expect, it } from 'vitest'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import { personalSessionToolNames } from '../personal-agent/sdk-session.js'
it('activates only the finite coordinator tools and leaves validation unable to call tools', () => {
  const tools = [{ name: 'project_tasks' }, { name: 'project_create_task' }] as ToolDefinition[]
  expect(personalSessionToolNames('project-coordination', 'bash', tools)).toEqual(['project_tasks', 'project_create_task'])
  expect(personalSessionToolNames('validation', 'bash', tools)).toEqual([])
  expect(personalSessionToolNames('personal', 'powershell', tools)).toEqual(['read', 'edit', 'write', 'powershell'])
})
