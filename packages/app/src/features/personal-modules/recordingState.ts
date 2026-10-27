// @arch docs/features/listening.md
// @test src/__tests__/mobile-root-tab-bar.test.ts
import { create } from 'zustand'
import { defaultListeningPreferences, type ListeningPreferences, type Prompt } from './types'
type State = {
  preferences: ListeningPreferences
  analysisError: boolean
  recognitionPending: boolean
  analysisProvider: 'none' | 'decision' | 'fallback'
  active: boolean
  starting: boolean
  stopping: boolean
  partial: string
  finalText: string
  liveTranscriptKey: string | null
  error: string | null
  syncError: string | null
  archiveError: string | null
  assistanceAvailable: boolean | null
  pending: number
  prompt: Prompt | null
  revision: number
  readAloud: boolean
  notification: string | null
  targetMachineId: string | null
  targetChanged: boolean
}
export const useRecordingState = create<State>(() => ({
  preferences: { ...defaultListeningPreferences },
  analysisError: false,
  recognitionPending: false,
  analysisProvider: 'none',
  active: false,
  starting: false,
  stopping: false,
  partial: '',
  finalText: '',
  liveTranscriptKey: null,
  error: null,
  syncError: null,
  archiveError: null,
  assistanceAvailable: null,
  pending: 0,
  prompt: null,
  revision: 0,
  readAloud: true,
  notification: null,
  targetMachineId: null,
  targetChanged: false,
}))
