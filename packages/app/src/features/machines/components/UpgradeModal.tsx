// @arch docs/architecture/app/modular-features.md#机器-feature
// @test src/__tests__/machine-feature-utils.test.ts
import type { Machine } from '@shennian/wire'
import { useMachineUpgrade } from '../hooks/useMachineUpgrade'
import { MachineUpgradeDialog } from './MachineUpgradeDialog'
export function UpgradeModal({ machine, onClose }: { machine: Machine; onClose(): void }) {
  const model = useMachineUpgrade(machine)
  return <MachineUpgradeDialog machine={machine} onClose={onClose} model={model} />
}
