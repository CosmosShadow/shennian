// @arch docs/features/published-agent-direct-conversations.md

import { useLocalSearchParams } from 'expo-router'
import { PublishedAgentLanding } from '../../src/features/published-agents/PublishedAgentLanding'

export default function PublishedAgentRoute() {
  const { publicId } = useLocalSearchParams<{ publicId: string }>()
  return <PublishedAgentLanding key={publicId} publicId={publicId} />
}
