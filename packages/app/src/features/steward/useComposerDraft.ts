// @arch docs/features/personal-modules.md
// @test src/__tests__/floating-composer-regressions.test.ts
import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
export type ComposerDraft = { id: number; text: string }
/** Consume each request once, preserving any text already in the global composer. */
export function useComposerDraft(request?: ComposerDraft, initialText = '') {
  const [input, setInput] = useState(initialText)
  const consumed = useRef(initialText ? request : undefined)
  const seed = useRef(initialText || request?.text || '')
  // The chat sender restores its persisted draft after mount. Merge the standby
  // draft in that first restore, instead of letting hydration erase fresh input.
  const restoreInput = useCallback<Dispatch<SetStateAction<string>>>((next) => {
    if (typeof next === 'string' && seed.current) {
      const initial = seed.current
      seed.current = ''
      setInput(mergeComposerDrafts(next, initial))
    } else setInput(next)
  }, [])
  useEffect(() => {
    if (request && consumed.current !== request) {
      consumed.current = request
      setInput((previous) => (previous.trim() ? `${previous}\n${request.text}` : request.text))
    }
  }, [request])
  return [input, setInput, restoreInput] as const
}

export function mergeComposerDrafts(saved: string, incoming: string) {
  if (!saved.trim()) return incoming
  if (!incoming.trim() || saved === incoming) return saved
  return `${saved}\n${incoming}`
}
