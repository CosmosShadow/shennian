// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/room-command.test.ts

/**
 * Structured next steps for Room command failures, so an Agent can act on the
 * error code instead of guessing. Managed-context failures never suggest
 * falling back to the user's human identity.
 */

export const SHENNIAN_SKILL_URL = 'https://shennian.net/skill.md'
export const SHENNIAN_INSTALL_URL = 'https://shennian.net/install.md'

export type RoomNextAction = Record<string, string>

const MANAGED_NEXT_ACTIONS: Record<string, RoomNextAction> = {
  managed_room_context_expired: {
    type: 'wait_for_next_activation',
    message:
      'The Room authorization was reset (Shennian restarted or a newer turn replaced it). Stop this send and do not retry now; it is issued again the next time a Room message wakes you. Do not send as the human user.',
  },
  managed_room_context_revoked: {
    type: 'stop_turn',
    message:
      'You are no longer bound to this Room, or your membership changed. Stop this turn, do not retry, and do not send as the human user.',
  },
  managed_room_context_invalid: {
    type: 'ask_user',
    message:
      "This machine's authorization does not match the Room grant. Ask the user to check the machine pairing in the Shennian app.",
  },
  managed_room_context_unavailable: {
    type: 'ask_user',
    message:
      'The managed Room context is not available in this process. Ask the user to check that Shennian is running and this agent is still bound to the Room.',
  },
  managed_room_binding_unavailable: {
    type: 'ask_user',
    message: 'This agent is not currently bound to an active Room. Ask the user to re-add it to the Room in the Shennian app.',
  },
  managed_room_membership_unavailable: {
    type: 'ask_user',
    message: 'This agent is not a member of the Room. Ask the user to re-add it to the Room in the Shennian app.',
  },
  machine_not_authorized: {
    type: 'ask_user',
    message: 'This machine is not authorized yet. Ask the user to pair it in the Shennian app.',
  },
  managed_room_action_forbidden: {
    type: 'stop_turn',
    message: 'This action is not allowed for the current turn. Do not retry it and do not send as the human user.',
  },
}

export function managedRoomNextAction(code: string): RoomNextAction | null {
  return MANAGED_NEXT_ACTIONS[code] ?? null
}

/**
 * For callers that are not Shennian-managed agents (or use a managed-only
 * command): only managed agents have implicit Room authority; anyone else acts
 * as the paired user through the official Skill and an explicit Room URL.
 */
export function externalRoomNextAction(): RoomNextAction {
  return {
    type: 'use_shennian_skill',
    message:
      `Only Shennian-managed agents have implicit Room permission. An ordinary AI cannot send as a managed Agent. To act as the paired user, use the public Shennian Skill and Client: reuse an exact Room URL returned earlier in the current workflow, or list the user's Rooms and select the exact returned URL; ask the user only when multiple candidates remain. Install the Skill from ${SHENNIAN_SKILL_URL} if missing, and install or pair the Client via ${SHENNIAN_INSTALL_URL}. Messages are sent as the user's own identity.`,
    skillUrl: SHENNIAN_SKILL_URL,
    installUrl: SHENNIAN_INSTALL_URL,
  }
}
