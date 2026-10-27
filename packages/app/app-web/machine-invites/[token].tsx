// @arch docs/architecture/machine-sharing.md

import { useLocalSearchParams } from 'expo-router'
import MachineInviteWebScreen from '../../src/features/machine-sharing/MachineInviteWebScreen'

export default function LightweightMachineInviteRoute() {
  const { token = '' } = useLocalSearchParams<{ token: string }>()
  return <MachineInviteWebScreen token={token} />
}
