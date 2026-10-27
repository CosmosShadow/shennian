// @arch docs/features/personal-modules.md
// @test src/__tests__/chat-composer-input.test.ts
import { useEffect, useRef } from 'react'
import type { ComposerFile, ComposerFiles } from './standbyFiles'
export function useComposerFileHandoff(
  batch: ComposerFiles | undefined,
  upload: (files: ComposerFile[]) => boolean,
  accepted?: () => void,
) {
  const consumed = useRef<number | null>(null)
  useEffect(() => {
    if (!batch || consumed.current === batch.id) return
    if (upload(batch.files)) {
      consumed.current = batch.id
      accepted?.()
    }
  }, [batch, upload, accepted])
}

export type { ComposerFiles } from './standbyFiles'
