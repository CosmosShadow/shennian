import type { ComponentProps } from 'react'
import { Platform } from 'react-native'
import {
  AppleSignInButton as AppleSignInButtonNative,
} from './AppleSignInButton.native'
import {
  AppleSignInButton as AppleSignInButtonWeb,
} from './AppleSignInButton.web'

type Props = ComponentProps<typeof AppleSignInButtonNative>

export function AppleSignInButton(props: Props) {
  if (Platform.OS === 'web') return <AppleSignInButtonWeb {...props} />
  return <AppleSignInButtonNative {...props} />
}
