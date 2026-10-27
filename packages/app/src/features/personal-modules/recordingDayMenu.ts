// @arch docs/features/listening.md
// @test src/__tests__/voice-entry-menu.test.ts
import { ActionSheetIOS, Alert, Platform } from 'react-native'
export function showRecordingDayMenu(
  title: string,
  t: (key: string) => string,
  exportText: () => void,
  summarize: () => void,
  confirmDelete: () => void,
) {
  const actions = [exportText, summarize, confirmDelete]
  const labels = ['personal_export', 'personal_summary', 'personal_delete_day'].map(key => t(key))
  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions(
      { title, options: [...labels, t('cancel')], destructiveButtonIndex: 2, cancelButtonIndex: 3 },
      (index) => actions[index]?.(),
    )
  } else {
    // Android Alert supports at most three buttons; Back/outside dismisses the menu.
    Alert.alert(
      title,
      undefined,
      labels.map((text, index) => ({
        text,
        onPress: actions[index],
        ...(index === 2 ? { style: 'destructive' as const } : {}),
      })),
      { cancelable: true },
    )
  }
}
