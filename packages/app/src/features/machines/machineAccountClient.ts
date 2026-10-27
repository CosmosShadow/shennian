// @arch docs/features/desktop-local-first-client.md#33-进程职责
// @test src/__tests__/machine-account-client-web.test.ts

export { machineAccountClient } from './machineAccountClient.native'
export { isMachineAccountUnauthorized } from './machineAccountClient.types'
export type {
  MachineAccountClient,
  MachineAgentCatalogEntry,
  MachineGrantInvite,
  MachineSessionCreateInput,
} from './machineAccountClient.types'
