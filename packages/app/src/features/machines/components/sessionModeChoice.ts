// @arch docs/features/manager-agent.md
// @test src/__tests__/session-mode-ui.test.ts

import type { SessionMode } from '@shennian/wire'

/**
 * Delegated work is still experimental, so leaving "work independently" for it
 * needs an explicit confirmation. Going back to standard or re-picking the
 * current value never prompts, and a cancelled confirmation changes nothing.
 */
export function requestSessionMode(
  current: SessionMode,
  next: SessionMode,
  confirmManager: (proceed: () => void) => void,
  apply: (mode: SessionMode) => void,
) {
  if (next === current) return
  if (next === 'manager') {
    confirmManager(() => apply('manager'))
    return
  }
  apply(next)
}
