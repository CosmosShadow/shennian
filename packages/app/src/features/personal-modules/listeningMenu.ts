// @arch docs/features/listening.md
// @test src/__tests__/listening-controls.test.ts
import { ActionSheetIOS, Alert, Platform } from 'react-native'

/** Match the native recording-day menu, including Android's three-button limit. */
export function showListeningMenu(
  title: string,
  labels: string[],
  cancel: string,
  select: (index: number) => void,
) {
  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions(
      { title, options: [...labels, cancel], cancelButtonIndex: labels.length },
      (index) => {
        if (index >= 0 && index < labels.length) select(index)
      },
    )
  } else {
    Alert.alert(
      title,
      undefined,
      labels.map((text, index) => ({ text, onPress: () => select(index) })),
      { cancelable: true },
    )
  }
}
