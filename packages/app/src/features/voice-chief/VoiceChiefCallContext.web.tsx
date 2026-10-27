import type { ReactNode } from 'react'

type VoiceChiefStartParams = {
  projectHint?: string
  incomingCallId?: string
  initialPrompt?: string
  reason?: string
}

function unavailable(): never {
  throw new Error('Voice Shennian calls are not available on Desktop or Web')
}

const desktopController = {
  active: false,
  mode: 'full' as const,
  call: null,
  startCall: (_params: VoiceChiefStartParams) => unavailable(),
  minimizeCall: unavailable,
  restoreCall: unavailable,
  clearCall: unavailable,
  floatingPosition: null,
  setFloatingPosition: (_position: { x: number; y: number }) => unavailable(),
}

export function VoiceChiefCallProvider({ children }: { children: ReactNode }) {
  return children
}

export function useVoiceChiefController() {
  return desktopController
}

export type { VoiceChiefStartParams }
