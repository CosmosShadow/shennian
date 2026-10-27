import { Platform, KeyboardAvoidingView } from 'react-native'
import { stewardPageContext, shouldShowStewardDock } from '../features/steward/contextualSteward'
import { ContextualStewardDock } from '../features/steward/ContextualStewardDock'
import { ContextualStewardContext, useContextualStewardDraft } from '../features/steward/ContextualStewardContext'
// @arch docs/architecture/mobile-navigation.md
import type { ReactNode } from 'react'
import { View } from 'react-native'
import { useAuthStore } from '../config/auth'
import { MobileTabEntryContext } from './useMobileModuleBack'
import { renderRecoverableScreen } from './RecoverableScreen'

type ScreenProps = { children: ReactNode; route: { name: string; key: string; params?: object } }

function MobileRootScreenFrame({ children, route }: ScreenProps) {
  const context = Platform.OS === 'web' ? null : stewardPageContext(route.name, route.params as Record<string, unknown>)
  const accountId = useAuthStore((state) => state.user?.id)
  const composer = useContextualStewardDraft(`${accountId}:${route.key}`)
  const resolvedContext = context ? stewardPageContext(route.name, { ...route.params, ...composer.details }) : null
  const showContextDock = shouldShowStewardDock(resolvedContext)
  return (
    <View style={{ flex: 1 }}>
      <MobileTabEntryContext.Provider value={false}>
          <ContextualStewardContext.Provider value={context ? composer : null}>
          <KeyboardAvoidingView enabled={showContextDock} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
            <View testID="mobile-page-viewport" style={{ flex: 1 }}>{children}</View>
            {showContextDock ? <ContextualStewardDock context={resolvedContext!} request={composer.request} /> : null}
          </KeyboardAvoidingView>
          </ContextualStewardContext.Provider>
      </MobileTabEntryContext.Provider>
    </View>
  )
}

export function renderMobileRootScreen(props: ScreenProps) {
  if (props.route.name === '(tabs)') return renderRecoverableScreen(props)
  return renderRecoverableScreen({ ...props, children: <MobileRootScreenFrame {...props} /> })
}
