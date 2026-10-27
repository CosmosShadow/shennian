// @arch docs/features/voice-shennian.md
// @test packages/app/src/__tests__/voice-chief-floating.test.ts

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useVoiceChiefCall } from './useVoiceChiefCall'
import { useAuthStore } from '../../config/auth'

type VoiceChiefStartParams = {
  projectHint?: string
  incomingCallId?: string
  initialPrompt?: string
  reason?: string
}

type VoiceChiefMode = 'full' | 'floating'
type VoiceChiefFloatingPosition = { x: number; y: number }
type ActiveCall = ReturnType<typeof useVoiceChiefCall>

type VoiceChiefCallContextValue = {
  active: boolean
  mode: VoiceChiefMode
  call: ActiveCall | null
  startCall(params: VoiceChiefStartParams): void
  minimizeCall(): void
  restoreCall(): void
  clearCall(): void
  floatingPosition: VoiceChiefFloatingPosition | null
  setFloatingPosition(position: VoiceChiefFloatingPosition): void
}

const noop = () => {}

const VoiceChiefCallContext = createContext<VoiceChiefCallContextValue>({
  active: false,
  mode: 'full',
  call: null,
  startCall: noop,
  minimizeCall: noop,
  restoreCall: noop,
  clearCall: noop,
  floatingPosition: null,
  setFloatingPosition: noop,
})

function areStartParamsEqual(a: VoiceChiefStartParams, b: VoiceChiefStartParams) {
  return (
    a.projectHint === b.projectHint &&
    a.incomingCallId === b.incomingCallId &&
    a.initialPrompt === b.initialPrompt &&
    a.reason === b.reason
  )
}

function VoiceChiefCallRunner({
  params,
  onCall,
  publishMeter,
}: {
  params: VoiceChiefStartParams
  onCall(call: ActiveCall | null): void
  publishMeter: boolean
}) {
  const call = useVoiceChiefCall(params)
  const publishedMeterLevel = publishMeter ? call.meterLevel : 0
  const publishedCall = useMemo(
    () => ({ ...call, meterLevel: publishedMeterLevel }),
    [
      call.state,
      call.error,
      call.transcripts,
      call.operationUpdates,
      call.muted,
      call.subtitles,
      call.outputRoute,
      call.toggleMute,
      call.setSubtitles,
      call.setOutputRoute,
      call.end,
      publishedMeterLevel,
    ],
  )

  useEffect(() => {
    onCall(publishedCall)
  }, [onCall, publishedCall])

  useEffect(() => () => onCall(null), [onCall])

  return null
}

export function VoiceChiefCallProvider({ children }: { children: ReactNode }) {
  const accountId = useAuthStore((current) => current.user?.id)
  const [params, setParams] = useState<(VoiceChiefStartParams & { accountId?: string }) | null>(null)
  const activeParams = params?.accountId === accountId ? params : null
  const [mode, setMode] = useState<VoiceChiefMode>('full')
  const [call, setCall] = useState<ActiveCall | null>(null)
  const [floatingPosition, setFloatingPosition] = useState<VoiceChiefFloatingPosition | null>(null)

  const startCall = useCallback((nextParams: VoiceChiefStartParams) => {
    setMode('full')
    if (!activeParams) setCall(null)
    setParams((current) => {
      if (current && current.accountId === accountId && areStartParamsEqual(current, nextParams)) return current
      return { ...nextParams, accountId }
    })
  }, [accountId, activeParams])

  const minimizeCall = useCallback(() => setMode('floating'), [])
  const restoreCall = useCallback(() => setMode('full'), [])
  const clearCall = useCallback(() => {
    setCall(null)
    setParams(null)
    setMode('full')
  }, [])
  const handleCall = useCallback((nextCall: ActiveCall | null) => setCall(nextCall), [])
  useEffect(() => {
    setParams((current) => current?.accountId === accountId ? current : null)
  }, [accountId])

  const value = useMemo<VoiceChiefCallContextValue>(
    () => ({
      active: Boolean(activeParams),
      mode,
      call: activeParams ? call : null,
      startCall,
      minimizeCall,
      restoreCall,
      clearCall,
      floatingPosition,
      setFloatingPosition,
    }),
    [activeParams, call, clearCall, floatingPosition, minimizeCall, mode, restoreCall, startCall],
  )

  return (
    <VoiceChiefCallContext.Provider value={value}>
      {children}
      {activeParams ? (
        <VoiceChiefCallRunner
          key={accountId}
          params={activeParams}
          onCall={handleCall}
          publishMeter={mode === 'floating'}
        />
      ) : null}
    </VoiceChiefCallContext.Provider>
  )
}

export function useVoiceChiefController() {
  return useContext(VoiceChiefCallContext)
}

export type { VoiceChiefStartParams }
