// @arch docs/features/network-rooms/ui.md#九受管智能体与-room-workspace
// @test src/__tests__/agent-participation-navigation.test.ts
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { Alert } from 'react-native'
import { usePreventRemove } from '@react-navigation/native'
import { useTranslation } from 'react-i18next'

const Context = createContext({ setBusy: (_busy: boolean) => {}, request: (action: () => void) => action() })
export const useParticipationActionGuard = () => useContext(Context)

/** Mode selection saves immediately; only an in-flight mutation blocks leaving. No draft or Apply UI. */
export function AgentParticipationMutationBoundary({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const request = useCallback((action: () => void) => {
    if (busy) Alert.alert(t('agent_mode_applying'))
    else action()
  }, [busy, t])
  usePreventRemove(busy, () => Alert.alert(t('agent_mode_applying')))
  const value = useMemo(() => ({ setBusy, request }), [request])
  return <Context.Provider value={value}>{children}</Context.Provider>
}
