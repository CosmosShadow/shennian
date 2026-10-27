// @arch docs/features/personal-modules.md
import { useCallback, useState } from 'react'
import { useFocusEffect } from '@react-navigation/native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useAuthStore } from '../../config/auth'
import { defaultScheduleDisplay, readScheduleDisplay, type ScheduleDisplay } from './scheduleModel'

export function useScheduleDisplay() {
  const accountId = useAuthStore((s) => s.user?.id ?? '')
  const key = `shennian:schedule:display:v1:${accountId}`
  const [saved, setSaved] = useState({ key, display: defaultScheduleDisplay })
  const display = saved.key === key ? saved.display : defaultScheduleDisplay
  const [ready, setReady] = useState(false)
  const [error, setError] = useState(false)
  useFocusEffect(
    useCallback(() => {
      let live = true
      setReady(false)
      setError(false)
      void AsyncStorage.getItem(key)
        .then((raw) => {
          if (live) setSaved({ key, display: readScheduleDisplay(raw) })
        })
        .catch(() => {
          if (live) setError(true)
        })
        .finally(() => {
          if (live) setReady(true)
        })
      return () => {
        live = false
      }
    }, [key]),
  )
  const update = async (next: ScheduleDisplay) => {
    setReady(false)
    setError(false)
    try {
      await AsyncStorage.setItem(key, JSON.stringify(next))
      if (useAuthStore.getState().user?.id === accountId) setSaved({ key, display: next })
    } catch {
      setError(true)
    } finally {
      if (useAuthStore.getState().user?.id === accountId) setReady(true)
    }
  }
  return { display, ready, error, update }
}
