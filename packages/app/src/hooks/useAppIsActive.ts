// @arch docs/architecture/app/mobile-push.md
// @test src/__tests__/room-conversation-screen.test.ts

import { useEffect, useState } from 'react'
import { AppState } from 'react-native'

export function useAppIsActive(): boolean {
  const [isActive, setIsActive] = useState(() => AppState.currentState === 'active')

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      setIsActive(nextState === 'active')
    })
    return () => subscription.remove()
  }, [])

  return isActive
}
