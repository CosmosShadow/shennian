// @covers src/routes/project-cli.ts

import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const services = vi.hoisted(() => ({
  load: vi.fn(), list: vi.fn(), create: vi.fn(), read: vi.fn(), send: vi.fn(), stop: vi.fn(),
}))
const auth = vi.hoisted(() => ({ machineId: 'machine-1' }))
const coordination = vi.hoisted(() => ({ owned: vi.fn(), send: vi.fn() }))
vi.mock('../services/local-apps/gateway.js', () => ({ ownedMachine: coordination.owned }))
vi.mock('../relay/server-requests.js', () => ({ sendServerReqToMachine: coordination.send }))

vi.mock('../middleware/auth.js', () => ({
  registerAuthDecorators(app: ReturnType<typeof Fastify>) {
    app.decorateRequest('userId', '')
    app.decorateRequest('machineId', '')
  },
  async requireUserOrMachineAuth(request: { userId: string; machineId: string }) {
    request.userId = 'user-1'
    request.machineId = auth.machineId
  },
  requireActivePlan: vi.fn(async () => {}),
}))
vi.mock('../services/voice-chief-control.js', () => ({
  loadVoiceChiefProjects: services.load,
  listProjectConversations: services.list,
  createProjectConversation: services.create,
  getConversationMessages: services.read,
  sendMessageToConversation: services.send,
  stopConversation: services.stop,
}))

import { projectCliRoutes } from '../routes/project-cli.js'

const task = (n: number) => ({
  conversationId: `task-${n}`, title: `任务${n}`, agentType: 'codex', modelId: null,
  status: 'active', runPhase: null, canStop: false, lastActivityAt: '2026-09-29T00:00:00.000Z',
  lastMessagePreview: '进行中', systemPrompt: 'secret', agentSessionId: 'native', daemonInstallationId: 'install',
})
const project = {
  projectId: 'project-1', displayName: 'app', summary: '摘要', machineId: 'machine-2',
  machineName: 'Mac', machineStatus: 'online', recentProgress: [], workDir: '/code/app',
  latestAgentType: 'codex', latestModelId: null,
  conversations: [task(1), task(2), task(3), task(4)],
}

async function build() {
  const app = Fastify()
  await app.register(projectCliRoutes, { prefix: '/project-cli' })
  return app
}

describe('project CLI routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    auth.machineId = 'machine-1'
    services.load.mockResolvedValue([project])
  })

  it('routes mobile and machine coordination through the same owner-checked Client command', async () => {
    const app = await build()
    auth.machineId = ''
    coordination.owned.mockResolvedValue({ id: 'target', online: true })
    coordination.send.mockResolvedValue({ ok: true, payload: { enabled: true } })
    const response = await app.inject({ method: 'POST', url: '/project-cli/coordination', payload: { machineId: 'target', workDir: '/code/app', command: 'get', action: 'injected' } })
    expect(response.statusCode).toBe(200)
    expect(coordination.owned).toHaveBeenCalledWith('user-1', 'target')
    expect(coordination.send).toHaveBeenCalledWith('target', expect.objectContaining({ method: 'personal.workspace', params: { action: 'project_coordination', workDir: '/code/app', command: 'get' } }), 20000)
    coordination.owned.mockRejectedValue(new Error('machine_owner_required'))
    coordination.send.mockClear()
    expect((await app.inject({ method: 'POST', url: '/project-cli/coordination', payload: { machineId: 'foreign', workDir: '/code/app' } })).statusCode).toBe(403)
    expect(coordination.send).not.toHaveBeenCalled()
    await app.close()
  })

  it('lists projects with a trimmed task preview and no internal fields', async () => {
    const app = await build()
    const response = await app.inject({ method: 'GET', url: '/project-cli/projects' })
    expect(services.load).toHaveBeenCalledWith('user-1')
    const [listed] = response.json().projects
    expect(listed).toMatchObject({ projectId: 'project-1', name: 'app', machineStatus: 'online', workDir: '/code/app' })
    expect(listed.recentTasks).toHaveLength(3)
    expect(JSON.stringify(response.json())).not.toMatch(/secret|native|install/)
    await app.close()
  })

  it('requires machine authentication', async () => {
    auth.machineId = ''
    const app = await build()
    const response = await app.inject({ method: 'GET', url: '/project-cli/projects' })
    expect(response.statusCode).toBe(403)
    expect(services.load).not.toHaveBeenCalled()
    await app.close()
  })

  it('creates a task with an idempotent operation id scoped to the user', async () => {
    services.create.mockResolvedValue({
      status: 'created', message: '已创建', projectId: 'project-1', projectName: 'app',
      conversationId: 'task-9', conversationTitle: '新任务',
    })
    const app = await build()
    const response = await app.inject({
      method: 'POST', url: '/project-cli/projects/project-1/tasks',
      payload: { instruction: '  修复登录  ', requestId: 'steward-0001-abcd', agentType: 'codex' },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ status: 'created', taskId: 'task-9', projectId: 'project-1' })
    expect(services.create).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1', projectId: 'project-1', message: '修复登录', agentType: 'codex',
      chiefConversationId: 'steward-user-1', callId: 'steward-0001-abcd', operationId: 'steward-0001-abcd',
    }))
    expect(services.create.mock.calls[0]![0]).not.toHaveProperty('completionNotifyMode')
    await app.close()
  })

  it('rejects malformed create input before touching any project', async () => {
    const app = await build()
    for (const payload of [
      { instruction: '', requestId: 'steward-0001-abcd' },
      { instruction: 'x'.repeat(20_001), requestId: 'steward-0001-abcd' },
      { instruction: 'ok', requestId: 'short' },
      { instruction: 'ok', requestId: 'steward-0001-abcd', agentType: 'pi' },
      { instruction: 'ok', requestId: 'steward-0001-abcd', agentType: 'manager' },
      { instruction: 'ok', requestId: 'steward-0001-abcd', modelId: 'bad model!' },
    ]) {
      const response = await app.inject({ method: 'POST', url: '/project-cli/projects/project-1/tasks', payload })
      expect(response.statusCode).toBe(400)
    }
    expect((await app.inject({ method: 'POST', url: '/project-cli/projects/bad%20id/tasks', payload: { instruction: 'ok', requestId: 'steward-0001-abcd' } })).statusCode).toBe(400)
    expect(services.load).not.toHaveBeenCalled()
    expect(services.create).not.toHaveBeenCalled()
    await app.close()
  })

  it('maps offline machines and missing targets to honest errors', async () => {
    const app = await build()
    services.create.mockResolvedValue({ status: 'unavailable', message: 'Mac 当前离线' })
    let response = await app.inject({
      method: 'POST', url: '/project-cli/projects/project-1/tasks',
      payload: { instruction: 'go', requestId: 'steward-0001-abcd' },
    })
    expect(response.statusCode).toBe(503)
    expect(response.json().error).toBe('machine_unavailable')
    services.create.mockResolvedValue({ status: 'failed', message: '项目不存在或不属于当前用户。' })
    response = await app.inject({
      method: 'POST', url: '/project-cli/projects/other/tasks',
      payload: { instruction: 'go', requestId: 'steward-0001-abcd' },
    })
    expect(response.statusCode).toBe(404)
    expect(response.json().error).toBe('not_found')
    await app.close()
  })

  it('lists, reads, sends to and stops tasks for the authenticated user only', async () => {
    services.list.mockResolvedValue({ status: 'ok', projectId: 'project-1', projectName: 'app', conversations: [task(1)], message: 'ok' })
    services.read.mockResolvedValue({ status: 'ok', conversationId: 'task-1', conversationTitle: '任务1', messages: [{ id: 'm', role: 'agent', ts: 1, text: '完成' }], message: 'ok' })
    services.send.mockResolvedValue({ status: 'delivered', message: '已发送', conversationId: 'task-1', conversationTitle: '任务1' })
    services.stop.mockResolvedValue({ status: 'stopped', message: '已请求停止', conversationId: 'task-1', conversationTitle: '任务1' })
    const app = await build()

    const listed = await app.inject({ method: 'GET', url: '/project-cli/projects/project-1/tasks?limit=5' })
    expect(listed.json().tasks[0]).toMatchObject({ taskId: 'task-1', title: '任务1' })
    expect(JSON.stringify(listed.json())).not.toContain('secret')
    expect(services.list).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'project-1', limit: 5 }))

    const read = await app.inject({ method: 'GET', url: '/project-cli/tasks/task-1/messages?limit=2' })
    expect(read.json()).toMatchObject({ taskId: 'task-1', messages: [{ text: '完成' }] })
    expect(services.read).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1', conversationId: 'task-1', limit: 2 }))

    const sent = await app.inject({ method: 'POST', url: '/project-cli/tasks/task-1/messages', payload: { text: '继续', requestId: 'steward-0002-abcd' } })
    expect(sent.json()).toMatchObject({ status: 'delivered', taskId: 'task-1' })
    expect(services.send).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1', conversationId: 'task-1', message: '继续', callId: 'steward-0002-abcd' }))

    const stopped = await app.inject({ method: 'POST', url: '/project-cli/tasks/task-1/stop' })
    expect(stopped.json()).toMatchObject({ status: 'stopped' })
    expect(services.stop).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1', conversationId: 'task-1' }))
    await app.close()
  })
})
