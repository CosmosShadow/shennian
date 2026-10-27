import { useCallback } from 'react'
import { useRouter, type Href } from 'expo-router'

export function useGoBack(fallback: Href = '/(main)') {
  const router = useRouter()

  return useCallback(() => {
    if (router.canGoBack()) {
      router.back()
    } else {
      router.replace(fallback)
    }
  }, [router, fallback])
}
