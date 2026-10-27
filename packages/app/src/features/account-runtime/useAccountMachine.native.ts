// @arch docs/features/desktop-local-first-client.md#33-进程职责

import { createUseRelay, getRelayManager } from '@shennian/shared'

/** Mobile owns its RelayManager; Desktop resolves the separate .web implementation. */
export const useAccountMachine = createUseRelay(getRelayManager)
