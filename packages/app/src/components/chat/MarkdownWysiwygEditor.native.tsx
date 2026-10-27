// @arch docs/architecture/app/chat-attachments-preview.md

import { Text, View } from 'react-native'
import type { Colors } from '../../hooks/useTheme'

export type MarkdownWysiwygEditorProps = {
  value: string
  colors: Colors
  isDark: boolean
  onChange: (value: string) => void
}

export function getMarkdownWysiwygThemeCss() {
  return ''
}

export function MarkdownWysiwygEditor({ colors }: MarkdownWysiwygEditorProps) {
  return (
    <View style={{ flex: 1, minHeight: 0, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <Text style={{ color: colors.textTertiary, fontSize: 13 }}>
        Markdown visual editing is available on Web and Desktop.
      </Text>
    </View>
  )
}
