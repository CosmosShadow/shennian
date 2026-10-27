// @arch docs/architecture/data-sync.md#4-session-index同步
// @test src/__tests__/local-session-preview.test.ts

import { createUseSessionPreviews } from '@shennian/shared'

/**
 * Native and Web both render the locally cached session-index preview tuple.
 * Transcript replication must never put per-session body scans on the list
 * render path.
 */
export const useSessionPreviews = createUseSessionPreviews()
