// @arch docs/architecture/machine-sharing.md

import { useLocalSearchParams } from 'expo-router'
import MachineInviteScreen from '../../src/features/machine-sharing/MachineInviteScreen'

export default function MachineInviteRoute() {
  const { token = '' } = useLocalSearchParams<{ token: string }>()
  return <MachineInviteScreen token={token} />
}
