// @arch docs/architecture/app/modular-features.md#聊天-feature
// @test src/__tests__/chat-screen-utils.test.ts
import { useEffect, useRef, useState } from 'react'
import { Animated } from 'react-native'

export function useChatMobileDrawer(fileDrawerOpen: boolean) {
  const mobileDrawerProgress = useRef(new Animated.Value(0)).current
  const [mobileDrawerVisible, setMobileDrawerVisible] = useState(false)
  useEffect(() => {
    if (fileDrawerOpen) {
      setMobileDrawerVisible(true)
      mobileDrawerProgress.setValue(0)
      Animated.timing(mobileDrawerProgress, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }).start()
      return
    }

    if (!mobileDrawerVisible) return

    Animated.timing(mobileDrawerProgress, {
      toValue: 0,
      duration: 180,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setMobileDrawerVisible(false)
      }
    })
  }, [fileDrawerOpen, mobileDrawerProgress, mobileDrawerVisible])

  return { mobileDrawerProgress, mobileDrawerVisible }
}
