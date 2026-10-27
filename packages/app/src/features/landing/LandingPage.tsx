import { Platform } from 'react-native'
import { Redirect } from 'expo-router'
import LandingContent from './LandingContent'

export default function LandingPage() {
  if (Platform.OS !== 'web') return <Redirect href="/" />
  return <LandingContent />
}
