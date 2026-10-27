// @arch docs/features/voice-shennian.md
// @test packages/app/src/__tests__/voice-chief-floating.test.ts

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
