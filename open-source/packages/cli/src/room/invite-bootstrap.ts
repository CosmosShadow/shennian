// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/room-invite-bootstrap.test.ts

type FetchLike = typeof fetch

export type TrustedRoomAgentBootstrap = {
  documentationUrl: 'https://shennian.net/install.md'
  skillUrl: 'https://shennian.net/skill.md'
  installCommand: 'npm install -g shennian@latest'
  upgradeCommand: 'shennian upgrade'
  minimumCliVersion: string
  actions: readonly [
    'room.create',
    'room.join',
    'room.status',
    'room.read',
    'room.send',
    'room.attachment.get',
    'room.leave',
  ]
}

export type RoomClientPreparation =
  | { status: 'ready' }
  | { status: 'install_required'; documentationUrl: string; command: string }
  | { status: 'upgrade_required'; documentationUrl: string; command: string }

const OFFICIAL_BOOTSTRAP_URL = 'https://shennian.net/api/room-invites/agent-bootstrap'
const EXPECTED_ACTIONS = [
  'room.create',
  'room.join',
  'room.status',
  'room.read',
  'room.send',
  'room.attachment.get',
  'room.leave',
] as const

export class RoomInviteBootstrapError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'RoomInviteBootstrapError'
  }
}

export async function fetchTrustedRoomAgentBootstrap(
  fetchImpl: FetchLike = fetch,
): Promise<TrustedRoomAgentBootstrap> {
  let response: Response
  try {
    response = await fetchImpl(OFFICIAL_BOOTSTRAP_URL, {
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    throw new RoomInviteBootstrapError(
      'room_bootstrap_unavailable',
      'Official Shennian Room setup information is unavailable.',
    )
  }
  if (!response.ok) {
    throw new RoomInviteBootstrapError(
      'room_bootstrap_unavailable',
      'Official Shennian Room setup information is unavailable.',
    )
  }
  let value: unknown
  try {
    value = await response.json()
  } catch {
    throw invalidBootstrap()
  }
  return validateTrustedRoomAgentBootstrap(value)
}

export function validateTrustedRoomAgentBootstrap(value: unknown): TrustedRoomAgentBootstrap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidBootstrap()
  const root = value as Record<string, unknown>
  const install = readObject(root.install)
  const roomCli = readObject(root.roomCli)
  if (
    root.schemaVersion !== 2 ||
    root.product !== 'shennian' ||
    root.inviteKind !== 'room' ||
    install.documentationUrl !== 'https://shennian.net/install.md' ||
    install.skillUrl !== 'https://shennian.net/skill.md' ||
    install.npmPackage !== 'shennian' ||
    install.distTag !== 'latest' ||
    install.installCommand !== 'npm install -g shennian@latest' ||
    install.upgradeCommand !== 'shennian upgrade' ||
    typeof install.minimumCliVersion !== 'string' ||
    !/^\d+\.\d+\.\d+$/.test(install.minimumCliVersion) ||
    roomCli.schemaVersion !== 1 ||
    roomCli.usage !== 'skill+cli' ||
    !sameStrings(roomCli.actions, EXPECTED_ACTIONS)
  ) {
    throw invalidBootstrap()
  }
  return {
    documentationUrl: 'https://shennian.net/install.md',
    skillUrl: 'https://shennian.net/skill.md',
    installCommand: 'npm install -g shennian@latest',
    upgradeCommand: 'shennian upgrade',
    minimumCliVersion: install.minimumCliVersion,
    actions: EXPECTED_ACTIONS,
  }
}

export function resolveRoomClientPreparation(
  currentVersion: string | null,
  bootstrap: TrustedRoomAgentBootstrap,
): RoomClientPreparation {
  if (currentVersion === null) {
    return {
      status: 'install_required',
      documentationUrl: bootstrap.documentationUrl,
      command: bootstrap.installCommand,
    }
  }
  const current = parseVersion(currentVersion)
  const minimum = parseVersion(bootstrap.minimumCliVersion)
  if (!current || !minimum) {
    throw new RoomInviteBootstrapError(
      'invalid_local_cli_version',
      'The installed Shennian CLI version could not be verified.',
    )
  }
  if (compareVersion(current, minimum) < 0) {
    return {
      status: 'upgrade_required',
      documentationUrl: bootstrap.documentationUrl,
      command: bootstrap.upgradeCommand,
    }
  }
  return { status: 'ready' }
}

function readObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidBootstrap()
  return value as Record<string, unknown>
}

function sameStrings(value: unknown, expected: readonly string[]): boolean {
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    value.every((entry, index) => entry === expected[index])
  )
}

function parseVersion(value: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/.exec(value.trim())
  if (!match) return null
  const parts = [Number(match[1]), Number(match[2]), Number(match[3])] as [number, number, number]
  return parts.every(Number.isSafeInteger) ? parts : null
}

function compareVersion(left: [number, number, number], right: [number, number, number]): number {
  for (let index = 0; index < 3; index += 1) {
    if (left[index]! !== right[index]!) return left[index]! - right[index]!
  }
  return 0
}

function invalidBootstrap(): RoomInviteBootstrapError {
  return new RoomInviteBootstrapError(
    'invalid_room_bootstrap',
    'Official Shennian Room setup information failed validation.',
  )
}
