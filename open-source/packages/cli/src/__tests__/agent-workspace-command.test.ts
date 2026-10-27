// @covers src/commands/agent-workspace.ts

import { Command } from 'commander'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { registerAgentWorkspaceCommands } from '../commands/agent-workspace.js'
import { registerAgentCommand } from '../commands/agent.js'
import { PublicAgentClient } from '../agents/public-agent-client.js'

const ROOM_URL = 'https://app.shennian.net/spaces/room_1'

function harness() {
  let output = ''
  let failures = 0
  const client = {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    listRooms: vi.fn(),
    createRoomSession: vi.fn(),
    removeFromRoom: vi.fn(),
    getPublication: vi.fn(),
    getPublicationReadiness: vi.fn(),
    createPublicationDraft: vi.fn(),
    updatePublication: vi.fn(),
    setPublicationAnonymousAccess: vi.fn(),
    activatePublication: vi.fn(),
    pausePublication: vi.fn(),
    revokePublication: vi.fn(),
    listPublicationConversations: vi.fn(),
    listMyDirectConversations: vi.fn(),
    openPublishedAgent: vi.fn(),
    readPublishedAgent: vi.fn(),
    readDirectConversation: vi.fn(),
    sendPublishedAgent: vi.fn(),
  }
  const callDaemon = vi.fn()
  const program = new Command().exitOverride()
  program.configureOutput({ writeOut: () => {}, writeErr: () => {} })
  const agent = program.command('agent')
  registerAgentWorkspaceCommands(agent, {
    client: client as unknown as PublicAgentClient,
    callDaemon,
    io: {
      write: (text) => { output += text },
      fail: () => { failures += 1 },
    },
  })
  return { program, client, callDaemon, result: () => ({ output, failures }) }
}

describe('public Agent workspace CLI', () => {
  it('owns the main Agent CRUD names and moves ACP registrations under an explicit compatibility group', () => {
    const program = new Command().exitOverride()
    program.configureOutput({ writeOut: () => {}, writeErr: () => {} })
    registerAgentCommand(program, {
      client: {} as PublicAgentClient,
      callDaemon: vi.fn(),
      io: { write: vi.fn(), fail: vi.fn() },
    })
    const agent = program.commands.find((command) => command.name() === 'agent')!
    expect(agent.commands.map((command) => command.name())).toEqual(expect.arrayContaining([
      'discover', 'check', 'list', 'get', 'create', 'update', 'delete', 'room', 'integration',
    ]))
    const integration = agent.commands.find((command) => command.name() === 'integration')!
    expect(integration.commands.map((command) => command.name())).toEqual([
      'add', 'list', 'remove', 'auth',
    ])
    expect(agent.helpInformation()).not.toMatch(/^\s+(add|remove|auth)\b/m)
  })

  it('runs a real readiness check before creating a standard Agent', async () => {
    const test = harness()
    test.callDaemon.mockResolvedValue({ ready: true })
    test.client.create.mockResolvedValue({ agent: { id: 'agent-1' } })

    await test.program.parseAsync([
      'agent', 'create', '--name', '客服', '--description', '帮助群成员',
      '--agent', 'codex', '--workdir', '/code/shennian', '--model', 'gpt-test',
      '--system-prompt', '回答产品问题',
    ], { from: 'user' })

    expect(test.callDaemon).toHaveBeenCalledWith(expect.objectContaining({
      method: 'agent.check',
      params: {
        agentType: 'codex',
        workDir: '/code/shennian',
        modelId: 'gpt-test',
      },
    }))
    expect(test.client.create).toHaveBeenCalledWith({
      displayName: '客服',
      description: '帮助群成员',
      runtimeAdapter: 'codex',
      workDir: '/code/shennian',
      modelId: 'gpt-test',
      systemPrompt: '回答产品问题',
    })
    expect(JSON.parse(test.result().output)).toMatchObject({
      ok: true,
      command: 'agent.create',
      result: { agent: { id: 'agent-1' } },
    })
  })

  it('does not create when readiness did not confirm a hello reply', async () => {
    const test = harness()
    test.callDaemon.mockResolvedValue({ ready: false })

    await test.program.parseAsync([
      'agent', 'create', '--name', '客服', '--description', '帮助群成员',
      '--agent', 'codex', '--workdir', '/code/shennian',
    ], { from: 'user' })

    expect(test.client.create).not.toHaveBeenCalled()
    expect(JSON.parse(test.result().output)).toMatchObject({
      ok: false,
      error: 'agent_check_invalid_response',
    })
  })

  it('sends an explicit deny-by-default Codex workspace policy on create', async () => {
    const test = harness()
    test.callDaemon.mockResolvedValue({ ready: true })
    test.client.create.mockResolvedValue({ agent: { id: 'isolated' } })
    await test.program.parseAsync([
      'agent', 'create', '--name', 'Friend', '--description', 'Private workspace',
      '--agent', 'codex', '--workdir', '/tmp/shennian-tests/unit/friend',
      '--file-access', 'workspace-write',
    ], { from: 'user' })
    expect(test.client.create).toHaveBeenCalledWith(expect.objectContaining({
      permissionPolicy: {
        version: 1, executionMode: 'restricted', fileAccess: 'workspace-write',
        externalCapabilities: { commandNetwork: false, webSearch: false,
          browser: false, computerUse: false, mcp: false },
      },
    }))
  })

  it('rejects unsupported file modes before checking or sharing', async () => {
    const test = harness()
    await test.program.parseAsync([
      'agent', 'share', '--name', 'Friend', '--agent', 'claude',
      '--workdir', '/tmp/shennian-tests/unit/friend', '--file-access', 'workspace-write',
    ], { from: 'user' })
    expect(test.callDaemon).not.toHaveBeenCalled()
    expect(test.client.create).not.toHaveBeenCalled()
    expect(JSON.parse(test.result().output)).toMatchObject({
      ok: false, error: 'agent_file_access_invalid',
    })
  })

  it('checks new AI creation once, then shares without another readiness gate', async () => {
    const test = harness()
    test.callDaemon.mockResolvedValue({ ready: true })
    test.client.create.mockResolvedValue({ agent: { id: 'agent-1' } })
    test.client.createPublicationDraft.mockResolvedValue({ publication: { status: 'draft' } })
    test.client.getPublicationReadiness.mockResolvedValue({ readiness: { activationAvailable: true } })
    test.client.getPublication.mockResolvedValueOnce({ publication: {
      status: 'draft', generation: 2, policyVersion: 3,
    } }).mockResolvedValueOnce({ publication: {
      status: 'draft', generation: 2, policyVersion: 3,
    } }).mockResolvedValueOnce({ publication: {
      status: 'active', shareUrl: 'https://shennian.test/p/unit-test-agent-publication',
      allowAnonymousVisitors: false,
    } })
    test.client.activatePublication.mockResolvedValue({ publication: { status: 'active' } })
    const testRoot = path.join(os.tmpdir(), 'shennian-tests', 'unit')
    await fs.mkdir(testRoot, { recursive: true })
    const temp = await fs.mkdtemp(path.join(testRoot, 'agent-share-'))
    const prior = process.env.SHENNIAN_HOME
    process.env.SHENNIAN_HOME = path.join(temp, 'shennian')
    try {
      await test.program.parseAsync(['agent', 'share', '--name', '派', '--agent', 'pi-coding-agent', '--require-login'],
        { from: 'user' })
      const workDir = test.client.create.mock.calls[0]![0].workDir as string
      expect(workDir).toMatch(/shennian-agent-workspaces\/agent-/)
      expect(await fs.readdir(workDir)).toEqual([])
      expect(test.client.activatePublication).toHaveBeenCalledWith('agent-1', 2, 3)
      expect(JSON.parse(test.result().output)).toMatchObject({ ok: true, command: 'agent.share',
        result: { status: 'active', visitorAccess: 'sign_in_required',
          shareUrl: 'https://shennian.test/p/unit-test-agent-publication' } })
    } finally {
      if (prior === undefined) delete process.env.SHENNIAN_HOME
      else process.env.SHENNIAN_HOME = prior
      await fs.rm(temp, { recursive: true, force: true })
    }
  })

  it('publishes an existing Agent without creating a second Agent or Room', async () => {
    const test = harness()
    test.client.get.mockResolvedValue({ agent: { id: 'agent-pi', status: 'active',
      displayName: 'Docker Pi', description: '客服', runtimeAdapter: 'pi-coding-agent',
      workDir: '/data/pi', modelId: null } })
    test.callDaemon.mockRejectedValue(new Error('daemon unavailable'))
    test.client.getPublication.mockResolvedValueOnce({ publication: { status: 'draft',
      generation: 1, policyVersion: 2 } }).mockResolvedValueOnce({ publication: {
      status: 'draft', generation: 1, policyVersion: 2,
    } }).mockResolvedValueOnce({ publication: { status: 'active',
      shareUrl: 'https://shennian.test/p/unit-test-agent-publication',
      allowAnonymousVisitors: false } })
    test.client.getPublicationReadiness.mockResolvedValue({ readiness: { activationAvailable: false } })
    test.client.activatePublication.mockResolvedValue({ publication: { status: 'active' } })
    await test.program.parseAsync(['agent', 'share', '--agent-id', 'agent-pi', '--require-login'], { from: 'user' })
    expect(test.callDaemon).not.toHaveBeenCalled()
    expect(test.client.getPublicationReadiness).not.toHaveBeenCalled()
    expect(test.client.create).not.toHaveBeenCalled()
    expect(test.client.createPublicationDraft).not.toHaveBeenCalled()
    expect(test.client.activatePublication).toHaveBeenCalledWith('agent-pi', 1, 2)
    expect(JSON.parse(test.result().output)).toMatchObject({ ok: true,
      result: { agentId: 'agent-pi', status: 'active', visitorAccess: 'sign_in_required' } })
  })

  it('can enable direct browser use on the same already active link', async () => {
    const test = harness()
    test.client.get.mockResolvedValue({ agent: { id: 'agent-pi', status: 'active',
      displayName: 'Docker Pi', description: '客服', runtimeAdapter: 'pi-coding-agent',
      workDir: '/data/pi', modelId: null } })
    test.callDaemon.mockResolvedValue({ ready: true })
    test.client.getPublication.mockResolvedValueOnce({ publication: {
      status: 'active', generation: 1, policyVersion: 2, allowAnonymousVisitors: false,
    } }).mockResolvedValueOnce({ publication: {
      status: 'active', generation: 1, policyVersion: 3, allowAnonymousVisitors: true,
    } }).mockResolvedValueOnce({ publication: {
      status: 'active', shareUrl: 'https://shennian.test/p/unit-test-agent-publication',
      allowAnonymousVisitors: true,
    } })
    await test.program.parseAsync(['agent', 'share', '--agent-id', 'agent-pi', '--anonymous'],
      { from: 'user' })
    expect(test.client.create).not.toHaveBeenCalled()
    expect(test.client.createPublicationDraft).not.toHaveBeenCalled()
    expect(test.client.activatePublication).not.toHaveBeenCalled()
    expect(test.client.setPublicationAnonymousAccess).toHaveBeenCalledWith('agent-pi', true, 1, 2)
    expect(JSON.parse(test.result().output)).toMatchObject({ ok: true,
      result: { status: 'active', visitorAccess: 'browser_guest_allowed' } })
  })

  it('requires login on the same guest-enabled link when explicitly requested', async () => {
    const test = harness()
    test.client.get.mockResolvedValue({ agent: { id: 'agent-pi', status: 'active',
      displayName: 'Pi', runtimeAdapter: 'pi-coding-agent', workDir: '/data/pi' } })
    test.callDaemon.mockResolvedValue({ ready: true })
    test.client.getPublication.mockResolvedValueOnce({ publication: {
      status: 'active', generation: 1, policyVersion: 2, allowAnonymousVisitors: true,
    } }).mockResolvedValueOnce({ publication: {
      status: 'active', generation: 1, policyVersion: 3, allowAnonymousVisitors: false,
    } }).mockResolvedValueOnce({ publication: {
      status: 'active', allowAnonymousVisitors: false,
      shareUrl: 'https://shennian.test/p/unit-test-agent-publication',
    } })
    await test.program.parseAsync(['agent', 'share', '--agent-id', 'agent-pi', '--require-login'],
      { from: 'user' })
    expect(test.client.setPublicationAnonymousAccess).toHaveBeenCalledWith('agent-pi', false, 1, 2)
    expect(test.client.create).not.toHaveBeenCalled()
    expect(JSON.parse(test.result().output)).toMatchObject({ ok: true,
      result: { visitorAccess: 'sign_in_required' } })
  })

  it('rejects contradictory access flags before testing or changing an Agent', async () => {
    const test = harness()
    await test.program.parseAsync(['agent', 'share', '--agent-id', 'agent-pi',
      '--anonymous', '--require-login'], { from: 'user' })
    expect(test.callDaemon).not.toHaveBeenCalled()
    expect(test.client.get).not.toHaveBeenCalled()
    expect(JSON.parse(test.result().output)).toMatchObject({ ok: false,
      error: 'agent_share_access_conflict' })
  })

  it('does not claim a share URL when server activation fails', async () => {
    const test = harness()
    test.callDaemon.mockResolvedValue({ ready: true })
    test.client.create.mockResolvedValue({ agent: { id: 'agent-1' } })
    test.client.createPublicationDraft.mockResolvedValue({ publication: { status: 'draft' } })
    test.client.getPublication.mockResolvedValue({ publication: {
      status: 'draft', generation: 1, policyVersion: 1,
    } })
    test.client.activatePublication.mockRejectedValue(new Error('publication conflict'))
    await test.program.parseAsync(['agent', 'share', '--name', '派', '--agent', 'pi-coding-agent',
      '--workdir', '/tmp/shennian-tests/unit/agent-share'], { from: 'user' })
    expect(test.client.activatePublication).toHaveBeenCalledWith('agent-1', 1, 1)
    expect(test.client.getPublicationReadiness).not.toHaveBeenCalled()
    expect(JSON.parse(test.result().output)).toMatchObject({ ok: false,
      error: 'agent_command_failed' })
  })

  it('defaults a one-step share to browser guest access before activation', async () => {
    const test = harness()
    test.callDaemon.mockResolvedValue({ ready: true })
    test.client.create.mockResolvedValue({ agent: { id: 'agent-1' } })
    test.client.createPublicationDraft.mockResolvedValue({ publication: { status: 'draft' } })
    test.client.getPublication.mockResolvedValueOnce({ publication: {
      status: 'draft', generation: 2, policyVersion: 3,
    } }).mockResolvedValueOnce({ publication: {
      status: 'draft', generation: 2, policyVersion: 4,
    } }).mockResolvedValueOnce({ publication: {
      status: 'active', shareUrl: 'https://shennian.test/p/unit-test-agent-publication',
      allowAnonymousVisitors: true,
    } })
    test.client.getPublicationReadiness.mockResolvedValue({ readiness: { activationAvailable: true } })
    test.client.activatePublication.mockResolvedValue({ publication: { status: 'active' } })
    await test.program.parseAsync(['agent', 'share', '--name', '客服', '--agent', 'codex',
      '--workdir', '/tmp/shennian-tests/unit/agent-guest'], { from: 'user' })
    expect(test.client.setPublicationAnonymousAccess).toHaveBeenCalledWith('agent-1', true, 2, 3)
    expect(test.client.activatePublication).toHaveBeenCalledWith('agent-1', 2, 4)
    expect(JSON.parse(test.result().output)).toMatchObject({ ok: true, result: {
      visitorAccess: 'browser_guest_allowed', status: 'active',
    } })
  })

  it('does not claim a guest-ready link when the final server snapshot has guest access off', async () => {
    const test = harness()
    test.callDaemon.mockResolvedValue({ ready: true })
    test.client.create.mockResolvedValue({ agent: { id: 'agent-1' } })
    test.client.createPublicationDraft.mockResolvedValue({ publication: { status: 'draft' } })
    test.client.getPublication.mockResolvedValueOnce({ publication: {
      generation: 1, policyVersion: 1,
    } }).mockResolvedValueOnce({ publication: {
      generation: 1, policyVersion: 2,
    } }).mockResolvedValueOnce({ publication: {
      status: 'active', allowAnonymousVisitors: false,
      shareUrl: 'https://shennian.test/p/unit-test-agent-publication',
    } })
    test.client.getPublicationReadiness.mockResolvedValue({ readiness: { activationAvailable: true } })
    test.client.activatePublication.mockResolvedValue({ publication: { status: 'active' } })
    await test.program.parseAsync(['agent', 'share', '--name', '客服', '--agent', 'codex',
      '--workdir', '/tmp/shennian-tests/unit/agent-guest', '--anonymous'], { from: 'user' })
    expect(JSON.parse(test.result().output)).toMatchObject({ ok: false,
      error: 'agent_publication_guest_unconfirmed' })
  })

  it('does not create or publish when the selected AI fails its hello', async () => {
    const test = harness()
    test.callDaemon.mockResolvedValue({ ready: false })
    await test.program.parseAsync(['agent', 'share', '--name', '派', '--agent', 'pi-coding-agent',
      '--workdir', '/tmp/shennian-tests/unit/agent-share'], { from: 'user' })
    expect(test.client.create).not.toHaveBeenCalled()
    expect(test.client.createPublicationDraft).not.toHaveBeenCalled()
    expect(JSON.parse(test.result().output)).toMatchObject({ ok: false,
      error: 'agent_check_invalid_response' })
  })

  it('skips the model check for profile-only updates and checks runtime changes', async () => {
    const current = {
      id: 'agent-1', displayName: '旧名', description: '介绍', systemPrompt: '提示',
      runtimeAdapter: 'codex', workDir: '/code/shennian', modelId: 'model-a',
    }
    const profile = harness()
    profile.client.get.mockResolvedValue({ agent: current })
    profile.client.update.mockResolvedValue({ agent: { ...current, displayName: '新名' } })
    await profile.program.parseAsync(['agent', 'update', 'agent-1', '--name', '新名'], { from: 'user' })
    expect(profile.callDaemon).not.toHaveBeenCalled()
    expect(profile.client.update).toHaveBeenCalledWith('agent-1', { displayName: '新名' })

    const runtime = harness()
    runtime.client.get.mockResolvedValue({ agent: current })
    runtime.callDaemon.mockResolvedValue({ ready: true })
    runtime.client.update.mockResolvedValue({ agent: { ...current, modelId: 'model-b' } })
    await runtime.program.parseAsync(
      ['agent', 'update', 'agent-1', '--model', 'model-b'],
      { from: 'user' },
    )
    expect(runtime.callDaemon).toHaveBeenCalledWith(expect.objectContaining({
      method: 'agent.check',
      params: expect.objectContaining({ modelId: 'model-b' }),
    }))
  })

  it('creates one dedicated session and binds it before reporting Room add success', async () => {
    const test = harness()
    test.client.createRoomSession.mockResolvedValue({
      existing: false,
      session: { id: 'session-1', agentType: 'codex' },
    })
    test.callDaemon.mockResolvedValue({ bindingId: 'binding-1', status: 'active' })

    await test.program.parseAsync(
      ['agent', 'room', 'add', 'agent-1', ROOM_URL, '--mode', 'mention_only'],
      { from: 'user' },
    )

    expect(test.client.createRoomSession).toHaveBeenCalledWith('agent-1', {
      roomId: 'room_1',
      assignmentIntentId: expect.stringMatching(/^cli-agent-room:/),
      activationMode: 'mention_only',
    })
    const assignmentIntentId = test.client.createRoomSession.mock.calls[0]![1].assignmentIntentId
    expect(test.callDaemon).toHaveBeenCalledWith({
      method: 'room.agent.bind-managed',
      params: {
        roomId: 'room_1',
        agentIdentityId: 'agent-1',
        nianSessionId: 'session-1',
        assignmentIntentId,
        agentType: 'codex',
        activationMode: 'mention_only',
      },
      timeoutMs: 120_000,
    })
    expect(JSON.parse(test.result().output)).toMatchObject({
      ok: true,
      command: 'agent.room.add',
      result: { binding: { bindingId: 'binding-1' } },
    })
  })

  it('uses only explicit stable Room URLs for list and removal', async () => {
    const list = harness()
    list.client.listRooms.mockResolvedValue({ rooms: [{ room: { roomId: 'room_1' } }] })
    await list.program.parseAsync(['agent', 'room', 'list', 'agent-1'], { from: 'user' })
    expect(list.client.listRooms).toHaveBeenCalledWith('agent-1')

    const remove = harness()
    remove.client.removeFromRoom.mockResolvedValue({ removed: true })
    await remove.program.parseAsync(
      ['agent', 'room', 'remove', 'agent-1', ROOM_URL],
      { from: 'user' },
    )
    expect(remove.client.removeFromRoom).toHaveBeenCalledWith('agent-1', 'room_1')

    const invalid = harness()
    await invalid.program.parseAsync(
      ['agent', 'room', 'remove', 'agent-1', 'https://example.com/spaces/room_1'],
      { from: 'user' },
    )
    expect(invalid.client.removeFromRoom).not.toHaveBeenCalled()
    expect(JSON.parse(invalid.result().output)).toMatchObject({ ok: false, error: 'invalid_room_ref' })
  })

  it('creates only an inactive draft and validates the exact owner Agent id', async () => {
    const test = harness()
    test.client.createPublicationDraft.mockResolvedValue({ publication: { status: 'draft' } })
    await test.program.parseAsync([
      'agent', 'publication', 'draft', 'agent-1', '--name', '小助手',
      '--description', '产品答疑', '--daily-limit', '200',
    ], { from: 'user' })
    expect(test.client.createPublicationDraft).toHaveBeenCalledWith('agent-1', {
      displayName: '小助手', description: '产品答疑', dailyMessageLimit: 200,
    })
    expect(JSON.parse(test.result().output)).toMatchObject({
      ok: true, command: 'agent.publication.draft', result: { publication: { status: 'draft' } },
    })
  })

  it('reads current publication readiness for an exact Agent id', async () => {
    const test = harness()
    test.client.getPublicationReadiness.mockResolvedValue({ readiness: {
      machineOnline: false, runtimeEligible: false, activationAvailable: false,
    } })
    await test.program.parseAsync(['agent', 'publication', 'readiness', 'agent-1'], { from: 'user' })
    expect(test.client.getPublicationReadiness).toHaveBeenCalledWith('agent-1')
    expect(JSON.parse(test.result().output)).toMatchObject({
      ok: true, command: 'agent.publication.readiness',
      result: { readiness: { activationAvailable: false } },
    })
  })

  it('passes explicit generation and policy version when updating publication', async () => {
    const test = harness()
    test.client.updatePublication.mockResolvedValue({ publication: { policyVersion: 3 } })
    await test.program.parseAsync([
      'agent', 'publication', 'update', 'agent-1', '--generation', '2',
      '--policy-version', '2', '--name', '新名字', '--description', '新介绍',
      '--daily-limit', '50',
    ], { from: 'user' })
    expect(test.client.updatePublication).toHaveBeenCalledWith('agent-1', {
      expectedGeneration: 2, expectedPolicyVersion: 2,
      displayName: '新名字', description: '新介绍', dailyMessageLimit: 50,
    })
  })

  it('passes exact versions to the gated publication activation', async () => {
    const test = harness()
    test.client.activatePublication.mockResolvedValue({ publication: { status: 'active' } })
    await test.program.parseAsync(['agent', 'publication', 'activate', 'agent-1',
      '--generation', '2', '--policy-version', '3'], { from: 'user' })
    expect(test.client.activatePublication).toHaveBeenCalledWith('agent-1', 2, 3)
  })

  it('reads, pauses, revokes, and pages one exact owner publication', async () => {
    const test = harness()
    test.client.getPublication.mockResolvedValue({ publication: { status: 'active' } })
    test.client.pausePublication.mockResolvedValue({ publication: { status: 'paused' } })
    test.client.revokePublication.mockResolvedValue({ publication: { status: 'revoked' } })
    test.client.listPublicationConversations.mockResolvedValue({ conversations: [], nextCursor: null })
    await test.program.parseAsync(['agent', 'publication', 'get', 'agent-1'], { from: 'user' })
    await test.program.parseAsync(['agent', 'publication', 'pause', 'agent-1',
      '--generation', '2', '--policy-version', '3'], { from: 'user' })
    await test.program.parseAsync(['agent', 'publication', 'revoke', 'agent-1',
      '--generation', '2'], { from: 'user' })
    await test.program.parseAsync(['agent', 'publication', 'conversations', 'agent-1',
      '--cursor', 'conversation-2'], { from: 'user' })
    expect(test.client.getPublication).toHaveBeenCalledWith('agent-1')
    expect(test.client.pausePublication).toHaveBeenCalledWith('agent-1', 2, 3)
    expect(test.client.revokePublication).toHaveBeenCalledWith('agent-1', 2)
    expect(test.client.listPublicationConversations).toHaveBeenCalledWith('agent-1', 'conversation-2')
  })

  it('uses the exact share URL and a caller-supplied retry id when sending', async () => {
    const test = harness()
    const url = `https://shennian.net/p/${'a'.repeat(32)}`
    test.client.sendPublishedAgent.mockResolvedValue({ status: 'pending', conversationId: 'conversation-1' })
    await test.program.parseAsync([
      'agent', 'public', 'send', url, '你好', '--client-message-id', 'request_1',
    ], { from: 'user' })
    expect(test.client.sendPublishedAgent).toHaveBeenCalledWith(url, {
      text: '你好', clientMessageId: 'request_1',
    })
    expect(JSON.parse(test.result().output).result.clientMessageId).toBe(
      test.client.sendPublishedAgent.mock.calls[0]![1].clientMessageId,
    )
    expect(JSON.parse(test.result().output).result.conversationRef).toBe('conversation-1')
    const invalid = harness()
    await invalid.program.parseAsync([
      'agent', 'public', 'send', url, '你好', '--client-message-id', 'bad:id',
    ], { from: 'user' })
    expect(invalid.client.sendPublishedAgent).not.toHaveBeenCalled()
    expect(JSON.parse(invalid.result().output)).toMatchObject({
      ok: false, error: 'publication_message_id_invalid',
    })
  })

  it('returns the canonical conversation id as the old and new references', async () => {
    const test = harness()
    const url = `https://shennian.net/p/${'a'.repeat(32)}`
    test.client.sendPublishedAgent.mockResolvedValue({
      conversationId: 'room-canonical', messageId: 'room-message-1',
      sequence: '7', status: 'pending', idempotent: false,
    })
    await test.program.parseAsync([
      'agent', 'public', 'send', url, '继续', '--client-message-id', 'stable_1',
    ], { from: 'user' })
    const sent = JSON.parse(test.result().output).result
    expect(sent).toMatchObject({
      conversationId: 'room-canonical', conversationRef: 'room-canonical',
      messageId: 'room-message-1', sequence: '7', clientMessageId: 'stable_1',
    })
    const history = harness()
    history.client.readDirectConversation.mockResolvedValue({
      conversation: { id: 'room-canonical' }, messages: [{ id: 'room-message-1', sequence: '7' }],
    })
    await history.program.parseAsync([
      'agent', 'public', 'history', sent.conversationRef, '--after', '6',
    ], { from: 'user' })
    expect(history.client.readDirectConversation).toHaveBeenCalledWith('room-canonical', { after: '6' })
    expect(JSON.parse(history.result().output).result.messages[0].id).toBe(sent.messageId)
  })

  it('reads authorized history by stable conversation id after link revocation', async () => {
    const test = harness()
    test.client.readDirectConversation.mockResolvedValue({ messages: [] })
    await test.program.parseAsync([
      'agent', 'public', 'history', 'conversation-1', '--after', '7',
    ], { from: 'user' })
    expect(test.client.readDirectConversation).toHaveBeenCalledWith('conversation-1', { after: '7' })
  })

  it('opens the latest page by default and accepts an older page cursor', async () => {
    const test = harness()
    test.client.readPublishedAgent.mockResolvedValue({ messages: [] })
    const url = `https://shennian.net/p/${'a'.repeat(32)}`
    await test.program.parseAsync(['agent', 'public', 'read', url], { from: 'user' })
    expect(test.client.readPublishedAgent).toHaveBeenCalledWith(url, {})
    await test.program.parseAsync(['agent', 'public', 'read', url, '--before', '101'], { from: 'user' })
    expect(test.client.readPublishedAgent).toHaveBeenLastCalledWith(url, { before: '101' })
  })

  it('lists only the paired visitor’s existing direct conversations', async () => {
    const test = harness()
    test.client.listMyDirectConversations.mockResolvedValue({
      conversations: [], nextCursor: null,
    })
    await test.program.parseAsync([
      'agent', 'public', 'list', '--cursor', 'conversation-1',
    ], { from: 'user' })
    expect(test.client.listMyDirectConversations).toHaveBeenCalledWith('conversation-1')
    expect(JSON.parse(test.result().output)).toMatchObject({
      ok: true, command: 'agent.public.list',
    })
  })
})
