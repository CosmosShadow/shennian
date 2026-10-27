// @arch docs/features/machine-onboarding.md
import { useEffect } from 'react'
import { useRouter } from 'expo-router'
import { useSheetsStore } from '@shennian/shared'

export default function AddMachineSheet() {
  const router = useRouter()
  const isOpen = useSheetsStore((store) => store.addMachineOpen)
  useEffect(() => {
    if (!isOpen) return
    useSheetsStore.getState().closeAddMachine()
    router.navigate('/(main)/add-machine')
  }, [isOpen, router])
  return null
}
