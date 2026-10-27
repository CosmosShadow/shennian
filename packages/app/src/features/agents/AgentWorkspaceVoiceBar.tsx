// @arch docs/features/agent-voice-configuration.md
// @test src/__tests__/agent-workspace-form.test.ts

import type { RefObject } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../../hooks/useTheme'
import { AgentVoiceConfigureControl } from './AgentVoiceConfigureControl'
import type { AgentWorkspaceFormHandle } from './AgentWorkspaceForm'

export function AgentWorkspaceVoiceBar({
  formRef,
  disabled,
}: {
  formRef: RefObject<AgentWorkspaceFormHandle | null>
  disabled?: boolean
}) {
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()

  return (
    <View
      style={[
        styles.root,
        {
          backgroundColor: colors.bg,
          borderTopColor: colors.border,
          paddingBottom: Math.max(insets.bottom, 10),
        },
      ]}
    >
      <AgentVoiceConfigureControl
        disabled={disabled}
        getDraft={() =>
          formRef.current?.getVoiceTextDraft() ?? {
            displayName: '',
            description: '',
            systemPrompt: '',
          }
        }
        onConfigured={(response, baseline) =>
          formRef.current?.applyVoiceConfiguration(response, baseline) ?? {
            summary: '',
            canUndo: false,
          }
        }
        onUndo={() => formRef.current?.undoVoiceConfiguration() ?? ''}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 10,
    paddingHorizontal: 16,
  },
})
