// @arch docs/tasks/20260929-1455_神念管家本机入口.md
// @test src/__tests__/steward-model.test.ts

import { useEffect, useMemo, useState } from 'react'
import { envelopeToChatMessage, getAgentDisplayName, useMachinesStore, type ChatMessage } from '@shennian/shared'
import type { AgentType, NianSession } from '@shennian/wire'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../../config/auth'
import { personalSessionBodyStore } from '../../storage/db'
import { getMachineAgentModels } from '../../utils/models'
import { syncVisiblePersonalSessionBody } from '../chat/services/personalBodyReplicaSync'
import {
  buildStewardPrelude,
  isStewardSession,
  stewardSwitchMessages,
  visibleStewardMessages,
  type StewardDividerNames,
  type StewardSwitchMark,
} from './stewardModel'

const MAX_EARLIER_CONVERSATIONS = 8
const TURNS_PER_CONVERSATION = 40

/**
 * Earlier steward conversations of the open machine, read from the local body replica (fetched from
 * that machine once if this device has never opened them), joined with the rules between them.
 *
 * Only the open machine's conversations take part: the title names one machine, so its timeline must
 * never show what was said on another one.
 */
export function useStewardPrelude(input: {
  sessions: readonly NianSession[]
  machineId: string | null | undefined
  currentId: string | null | undefined
  marks: readonly StewardSwitchMark[]
}) {
  const { t } = useTranslation()
  const accountId = useAuthStore((state) => state.user?.id ?? '')
  const machines = useMachinesStore((state) => state.machines)
  const [earlier, setEarlier] = useState<ReadonlyMap<string, ChatMessage[]>>(new Map())
  const { currentId, machineId, marks } = input
  const sessions = useMemo(
    () => input.sessions.filter((session) =>
      isStewardSession(session) && !session.deletedAt && session.machineId === machineId),
    [input.sessions, machineId],
  )

  const earlierIds = useMemo(
    () => [...sessions]
      .filter((session) => session.id !== currentId)
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .slice(0, MAX_EARLIER_CONVERSATIONS)
      .map((session) => ({ id: session.id, machineId: session.machineId, draft: session.localCreationState === 'draft' })),
    [currentId, sessions],
  )
  const earlierKey = earlierIds.map((item) => item.id).join(',')

  useEffect(() => {
    if (!accountId) return
    let active = true
    const load = async (id: string): Promise<ChatMessage[]> => {
      const envelopes = await personalSessionBodyStore.getMessagesByUserTurns(accountId, id, {
        turnLimit: TURNS_PER_CONVERSATION,
      })
      return visibleStewardMessages(envelopes.map((envelope) => envelopeToChatMessage(envelope, envelope.deliveryState)))
    }
    void (async () => {
      const next = new Map<string, ChatMessage[]>()
      for (const item of earlierIds) {
        if (item.draft) continue
        try {
          let messages = await load(item.id)
          if (!messages.length) {
            // Never opened on this device: pull it once from its machine, if that machine is reachable.
            const machine = machines.find((candidate) => candidate.id === item.machineId)
            if (machine?.online) {
              await syncVisiblePersonalSessionBody(item.id).catch(() => {})
              messages = await load(item.id)
            }
          }
          if (messages.length) next.set(item.id, messages)
        } catch { /* an unreadable earlier conversation is simply not shown */ }
      }
      if (active) setEarlier(next)
    })()
    return () => { active = false }
    // machines change often; the conversation set is what decides what to read.
  }, [accountId, earlierKey])

  const names = useMemo<StewardDividerNames>(() => ({
    machine: (session) => machines.find((machine) => machine.id === session.machineId)?.name ?? session.machineName ?? '',
    agent: (session) => getAgentDisplayName(session.agentType),
    model: (session) => {
      const machine = machines.find((candidate) => candidate.id === session.machineId)
      const model = getMachineAgentModels(machine, session.agentType).find((item) => item.id === session.modelId)
      return model?.name ?? session.modelId ?? t('agents_default_model')
    },
    newConversation: t('steward_context_started'),
    switchTo: (name) => t('steward_divider_switch', { name }),
  }), [machines, t])

  const prelude = useMemo(
    () => buildStewardPrelude({ sessions, currentId, earlierMessages: earlier, names }),
    [currentId, earlier, names, sessions],
  )
  // Switches made inside the open conversation are rules too, placed where they happened.
  const switches = useMemo(
    () => stewardSwitchMessages({
      marks,
      sessionId: currentId,
      switchTo: (name) => t('steward_divider_switch', { name }),
      agentName: (agentType) => getAgentDisplayName(agentType as AgentType),
      modelName: (modelId) => {
        const machine = machines.find((candidate) => candidate.id === machineId)
        const agentType = sessions.find((session) => session.id === currentId)?.agentType
        const model = agentType
          ? getMachineAgentModels(machine, agentType).find((item) => item.id === modelId)
          : undefined
        return model?.name ?? modelId ?? t('agents_default_model')
      },
    }),
    [currentId, machineId, machines, marks, sessions, t],
  )
  return { prelude, switches }
}
