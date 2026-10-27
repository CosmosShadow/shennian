import { useLocalSearchParams } from 'expo-router'
import { VoiceChiefScreen } from '../../src/features/voice-chief/VoiceChiefScreen'

export default function VoiceChiefRoute() {
  const params = useLocalSearchParams<{
    projectHint?: string
    incomingCallId?: string
    initialPrompt?: string
    reason?: string
  }>()
  return (
    <VoiceChiefScreen
      projectHint={typeof params.projectHint === 'string' ? params.projectHint : undefined}
      incomingCallId={typeof params.incomingCallId === 'string' ? params.incomingCallId : undefined}
      initialPrompt={typeof params.initialPrompt === 'string' ? params.initialPrompt : undefined}
      reason={typeof params.reason === 'string' ? params.reason : undefined}
    />
  )
}
