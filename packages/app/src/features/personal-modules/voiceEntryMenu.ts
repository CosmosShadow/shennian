// @arch docs/features/listening.md
// @test src/__tests__/voice-entry-menu.test.ts
import { ActionSheetIOS, Alert, Platform } from 'react-native'

/** Navigation only: choosing recording must never start microphone capture. */
export function showVoiceEntryMenu(
  t: (key: string) => string,
  call: () => void,
  records: () => void,
) {
  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: t('listening_entry_title'),
        options: [t('voice_chief_call_action'), t('personal_entry_recording'), t('cancel')],
        cancelButtonIndex: 2,
      },
      (index) => {
        if (index === 0) call()
        else if (index === 1) records()
      },
    )
  } else {
    Alert.alert(t('listening_entry_title'), undefined, [
      { text: t('voice_chief_call_action'), onPress: call },
      { text: t('personal_entry_recording'), onPress: records },
      { text: t('cancel'), style: 'cancel' },
    ])
  }
}
