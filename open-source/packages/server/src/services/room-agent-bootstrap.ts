// @arch open-source/docs/server-runtime.md
// @test src/__tests__/room-agent-bootstrap.test.ts

export const ROOM_AGENT_BOOTSTRAP = Object.freeze({
  schemaVersion: 2 as const,
  product: 'shennian' as const,
  inviteKind: 'room' as const,
  install: Object.freeze({
    documentationUrl: 'https://shennian.net/install.md',
    skillUrl: 'https://shennian.net/skill.md',
    npmPackage: 'shennian',
    distTag: 'latest',
    installCommand: 'npm install -g shennian@latest',
    upgradeCommand: 'shennian upgrade',
    minimumCliVersion: '0.3.2',
  }),
  roomCli: Object.freeze({
    schemaVersion: 1 as const,
    actions: Object.freeze([
      'room.create',
      'room.join',
      'room.status',
      'room.read',
      'room.send',
      'room.attachment.get',
      'room.leave',
    ]),
    usage: 'skill+cli' as const,
  }),
})

export function roomAgentBootstrapLinkHeader(): string {
  return [
    '<https://shennian.net/api/room-invites/agent-bootstrap>; rel="service-desc"; type="application/json"',
    '<https://shennian.net/install.md>; rel="help"; type="text/markdown"',
    '<https://shennian.net/skill.md>; rel="service-desc"; type="text/markdown"',
  ].join(', ')
}
