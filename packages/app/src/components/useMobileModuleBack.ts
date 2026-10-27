// @arch docs/architecture/mobile-navigation.md
import { createContext, useContext } from 'react'
import { useRouter } from 'expo-router'

export const MobileTabEntryContext = createContext(false)

/** A feature push has a back action; a root tab switch never gains one. */
export function useMobileModuleBack(): (() => void) | undefined {
  const tabEntry = useContext(MobileTabEntryContext)
  const router = useRouter()
  return tabEntry
    ? undefined
    : () => {
        if (router.canGoBack()) router.back()
        else router.replace('/(main)/(tabs)/home')
      }
}
