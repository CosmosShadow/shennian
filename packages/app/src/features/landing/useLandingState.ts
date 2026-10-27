import { useCallback } from 'react'
import { persistWebLanguagePreference } from '../../config/i18n'

type Options = {
  i18n: { language: string; changeLanguage: (language: string) => void }
  isAuthenticated: boolean
  router: { navigate: (href: string) => void }
  width: number
}

export function useLandingState({ i18n, isAuthenticated, router, width }: Options) {
  const handleOpenApp = useCallback(() => {
    router.navigate(isAuthenticated ? '/(main)' : '/(auth)/login')
  }, [router, isAuthenticated])

  const navigateWithAuth = useCallback(
    (href: string) => {
      if (isAuthenticated) {
        router.navigate(href)
        return
      }
      router.navigate(`/(auth)/login?redirect=${encodeURIComponent(href)}`)
    },
    [isAuthenticated, router],
  )

  const handleLogin = useCallback(() => {
    router.navigate('/(auth)/login')
  }, [router])

  const handleSignup = useCallback(() => {
    router.navigate('/(auth)/login?mode=signup')
  }, [router])

  const isWide = width >= 768
  const cols = width >= 1024 ? 3 : width >= 640 ? 2 : 1

  const toggleLang = useCallback(() => {
    const next = i18n.language === 'zh' ? 'en' : 'zh'
    i18n.changeLanguage(next)
    persistWebLanguagePreference(next)
  }, [i18n])

  // Hong Kong/global service is temporarily offline.
  // const isCN = typeof window !== 'undefined' && window.location.hostname.endsWith('shennian.net')
  // const regionTargetUrl = isCN ? 'https://shennian.ai' : 'https://shennian.net'
  // const regionLabel = isCN ? 'shennian.ai' : 'shennian.net'
  const regionTargetUrl = 'https://shennian.net'
  const regionLabel = 'shennian.net'

  const scrollTo = useCallback((id: string) => {
    try {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
    } catch {}
  }, [])

  return {
    cols,
    handleLogin,
    handleOpenApp,
    handleSignup,
    isWide,
    navigateWithAuth,
    regionLabel,
    regionTargetUrl,
    scrollTo,
    toggleLang,
  }
}
