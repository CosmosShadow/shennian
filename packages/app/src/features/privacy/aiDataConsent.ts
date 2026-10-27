// @arch docs/features/ai-data-sharing-consent.md
// @test src/__tests__/privacy-simplification.test.ts

import { Alert, Linking, Platform } from 'react-native'
import { PUBLIC_SITE_URL } from '../../config/server'
import { showWebAiDataConsent } from './webAiDataConsent'

export type AiDataConsentKind = 'personal' | 'room' | 'voice' | 'interactive' | 'recording'

const DISCLOSURE_VERSIONS: Record<AiDataConsentKind, number> = {
  personal: 1,
  recording: 1,
  interactive: 1,
  room: 1,
  voice: 2,
}
const STORAGE_KEY = 'shennian:ai-data-consent:v1'

type ConsentState = Record<string, Partial<Record<AiDataConsentKind, number>>>

async function readState(): Promise<ConsentState> {
  try {
    const raw = Platform.OS === 'web'
      ? globalThis.localStorage?.getItem(STORAGE_KEY) ?? null
      : await require('@react-native-async-storage/async-storage').default.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

async function writeState(state: ConsentState): Promise<void> {
  const raw = JSON.stringify(state)
  if (Platform.OS === 'web') {
    globalThis.localStorage?.setItem(STORAGE_KEY, raw)
    return
  }
  await require('@react-native-async-storage/async-storage').default.setItem(STORAGE_KEY, raw)
}

export async function hasAiDataConsent(
  accountId: string,
  kind: AiDataConsentKind,
): Promise<boolean> {
  if (!accountId) return false
  return (await readState())[accountId]?.[kind] === DISCLOSURE_VERSIONS[kind]
}

export async function grantAiDataConsent(
  accountId: string,
  kind: AiDataConsentKind,
): Promise<void> {
  if (!accountId) return
  const state = await readState()
  state[accountId] = { ...state[accountId], [kind]: DISCLOSURE_VERSIONS[kind] }
  await writeState(state)
}

export async function revokeAiDataConsents(accountId: string): Promise<void> {
  if (!accountId) return
  const state = await readState()
  delete state[accountId]
  await writeState(state)
}

export async function requestAiDataConsent(options: {
  accountId: string
  kind: AiDataConsentKind
  title: string
  message: string
  allowLabel: string
  declineLabel: string
  privacyLabel: string
}): Promise<boolean> {
  if (!options.accountId) return false
  if (await hasAiDataConsent(options.accountId, options.kind)) return true
  const approved = Platform.OS === 'web'
    ? await showWebAiDataConsent({ ...options, privacyUrl: `${PUBLIC_SITE_URL}/privacy` })
    : await new Promise<boolean>((resolve) => {
        Alert.alert(options.title, options.message, [
          { text: options.declineLabel, style: 'cancel', onPress: () => resolve(false) },
          {
            text: options.privacyLabel,
            onPress: () => {
              void Linking.openURL(`${PUBLIC_SITE_URL}/privacy`)
              resolve(false)
            },
          },
          {
            text: options.allowLabel,
            onPress: () => resolve(true),
          },
        ])
      })
  if (!approved) return false
  try {
    await grantAiDataConsent(options.accountId, options.kind)
    return true
  } catch {
    return false
  }
}
