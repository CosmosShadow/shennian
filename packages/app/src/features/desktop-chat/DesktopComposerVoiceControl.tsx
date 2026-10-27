// @arch docs/design/desktop/macos-interaction-baseline.md#消息与输入框
// @test ../../__tests__/desktop-composer-controls.test.ts

import { useTranslation } from 'react-i18next'
import type { Colors } from '../../hooks/useTheme'
import type { VoiceComposerPhase } from '../chat/utils/voice'
import { DesktopComposerIconButton } from './DesktopComposerIconButton'

export function DesktopComposerVoiceControl({
  phase,
  onStart,
  onStop,
  disabled,
  disabledReason,
  colors,
}: {
  phase: VoiceComposerPhase
  onStart: () => void | Promise<unknown>
  onStop: () => void | Promise<unknown>
  disabled: boolean
  disabledReason?: string | null
  colors: Colors
}) {
  const { t } = useTranslation()

  if (phase === 'listening') {
    return (
      <DesktopComposerIconButton
        testID="voice-listening-indicator"
        icon="square"
        variant="primary"
        colors={colors}
        accessibilityLabel={t('stop')}
        onPress={() => void onStop()}
      />
    )
  }

  const refining = phase === 'refining'
  return (
    <DesktopComposerIconButton
      testID={refining ? 'voice-refining-indicator' : 'voice-btn'}
      icon={refining ? 'activity' : 'mic'}
      variant="neutral"
      colors={colors}
      selected={refining}
      disabled={disabled}
      accessibilityLabel={
        disabled
          ? (disabledReason ?? t('voice_input'))
          : t(refining ? 'voice_optimizing_continue' : 'voice_input')
      }
      onPress={() => void onStart()}
    />
  )
}
