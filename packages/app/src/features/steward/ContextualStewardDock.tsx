// @arch docs/architecture/mobile-navigation.md
import { useEffect, useState } from 'react'
import { InteractionManager, Platform, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useIsFocused } from '@react-navigation/native'
import { useComposerBottomInset } from '../chat/hooks/useComposerBottomInset'
import { StewardScreen } from './StewardScreen'
import type { StewardPageContext } from './contextualSteward'
import { ProjectCoordinationComposer } from '../projects/coordination/ProjectCoordinationComposer'
export function ContextualStewardDock({ context, request }: { context: StewardPageContext; request?: { id: number; text: string } }) {
  const focused = useIsFocused()
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (!focused) { setReady(false); return }
    let live = true
    // JS Stack registers an interaction for its card animation. Mount the send
    // controller after that work, not in the first frames of the entering page.
    const task = InteractionManager.runAfterInteractions(() => { if (live) setReady(true) })
    return () => { live = false; task.cancel() }
  }, [focused])
  const insets = useSafeAreaInsets()
  const bottom = useComposerBottomInset(insets.bottom)
  // Native-stack focus arrives separately from layout. Keep the slot on both
  // sides of a Tab switch, without running an inactive ChatScreen/send controller.
  const minimumHeight = (Platform.OS === 'android' ? 50 : 48) + 6 + bottom
  return <View testID="contextual-composer-slot" style={{ minHeight: minimumHeight }}>
    {focused && ready ? context.route === 'project' && context.details.projectCoordination === 'enabled'
      ? <ProjectCoordinationComposer machineId={context.details.machineId ?? ''} workDir={context.details.workDir ?? ''} bottom={bottom} />
      : <StewardScreen dockOnly pageContext={context} composerDraft={request} /> : null}
  </View>
}
