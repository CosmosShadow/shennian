// @covers open-source/packages/server/src/services/room-agent-bootstrap.ts

import { describe, expect, it } from 'vitest'
import {
  ROOM_AGENT_BOOTSTRAP,
  roomAgentBootstrapLinkHeader,
} from '../services/room-agent-bootstrap.js'

describe('Room Agent bootstrap metadata', () => {
  it('contains only fixed official Skill + CLI metadata', () => {
    expect(ROOM_AGENT_BOOTSTRAP).toEqual({
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
        actions: ['room.create', 'room.join', 'room.status', 'room.read', 'room.send', 'room.attachment.get', 'room.leave'],
        usage: 'skill+cli',
      },
    })
    expect(JSON.stringify(ROOM_AGENT_BOOTSTRAP)).not.toMatch(/description|roomId|token|message|integration|mcp|hook/i)
  })

  it('advertises only fixed official HTTPS resources', () => {
    expect(roomAgentBootstrapLinkHeader()).toBe(
      '<https://shennian.net/api/room-invites/agent-bootstrap>; rel="service-desc"; type="application/json", <https://shennian.net/install.md>; rel="help"; type="text/markdown", <https://shennian.net/skill.md>; rel="service-desc"; type="text/markdown"',
    )
  })
})
