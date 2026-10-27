// @arch docs/design/desktop/unified-desktop-control.md
// @test ../../src/__tests__/desktop-machine-list-projection.test.ts
// @test ../../src/__tests__/desktop-machine-pairing.test.ts
import { useLocalSearchParams } from 'expo-router'
import DesktopAddMachineScreen from '../../src/features/desktop-machines/DesktopAddMachineScreen'
import DesktopMachinesScreen from '../../src/features/desktop-machines/DesktopMachinesScreen'

export default function DesktopMachinesRoute() {
  const { add } = useLocalSearchParams<{ add?: string }>()
  return add === '1' ? <DesktopAddMachineScreen /> : <DesktopMachinesScreen />
}
