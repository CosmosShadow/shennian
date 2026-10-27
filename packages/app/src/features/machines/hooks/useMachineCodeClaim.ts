import { getServerUrl } from '../../../config/server'
// @arch docs/features/machine-onboarding.md
// @test ../../../__tests__/first-machine-setup.test.ts
// Inline pairing for the mobile add-machine page: pair codes are claimed in place,
// machine-sharing links open their confirmation page, room links ask before leaving.
import { useEffect, useRef, useState } from 'react'
import { Alert } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useMachinesStore } from '@shennian/shared'
import { parseScanPayload } from '../../../utils/scan'
import { machineAccountClient, isMachineAccountUnauthorized } from '../machineAccountClient'

const PAIR_TOKEN = /^(?:sn-[a-z]{4}-[a-z]{4}-[a-z]{4}|auth-[A-Za-z0-9_-]+)$/

export function useMachineCodeClaim({ from }: { from?: string } = {}) {
  const { t } = useTranslation()
  const router = useRouter()
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const claiming = useRef(false)
  const active = useRef(true)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])

  const finish = (machineId?: string) => {
    if (from === 'create-project') router.dismissTo('/(main)/create-project')
    else if (machineId)
      router.replace({ pathname: '/(main)/machine/[machineId]', params: { machineId } })
    else router.replace('/(main)/machines')
  }

  const submit = async () => {
    if (claiming.current) return
    setError('')
    const parsed = parseScanPayload(input, getServerUrl())
    if (parsed?.kind === 'room') {
      Alert.alert(t('setup_room_link'), t('setup_room_link_hint'), [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('confirm'),
          onPress: () =>
            router.navigate({
              pathname: '/(main)/room-join',
              params: { roomId: parsed.roomId, invite: parsed.inviteToken },
            }),
        },
      ])
      return
    }
    if (parsed?.kind === 'login' || parsed?.kind === 'roomAccess') {
      setError(t('setup_authorization_code'))
      return
    }
    if (parsed?.kind === 'share') {
      router.navigate(`/machine-invites/${encodeURIComponent(parsed.token)}`)
      return
    }
    if (parsed?.kind !== 'pair' || !PAIR_TOKEN.test(parsed.token)) {
      setError(t('machine_code_failed'))
      return
    }
    claiming.current = true
    setBusy(true)
    try {
      const result = await machineAccountClient.claimPair(parsed.token)
      if (!active.current) return
      try {
        useMachinesStore.getState().setMachines(await machineAccountClient.listMachines())
      } catch {
        // The claim already succeeded; the machine list catches up on its next refresh.
      }
      if (active.current) finish(result?.machineId)
    } catch (cause) {
      if (active.current)
        setError(
          t(isMachineAccountUnauthorized(cause) ? 'pair_auth_expired' : 'machine_code_failed'),
        )
    } finally {
      claiming.current = false
      if (active.current) setBusy(false)
    }
  }

  return { input, setInput, busy, error, submit }
}
