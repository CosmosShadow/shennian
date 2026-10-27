// @arch docs/architecture/server/auth-flows.md
// @test src/__tests__/auth-providers.test.ts
import { create } from 'zustand'

export type NicknamePrompt = {
  id: number
  name: string
  accountId?: string
  save: (name: string) => Promise<void>
  finish: () => void
}

export const useNicknamePrompt = create<{ prompt: NicknamePrompt | null }>(() => ({ prompt: null }))
let promptSequence = 0

/** Explicit login events only; never called by refresh, hydration or Room navigation. */
export function requestNicknameSetup(input: Omit<NicknamePrompt, 'finish' | 'id'>): Promise<void> {
  useNicknamePrompt.getState().prompt?.finish()
  return new Promise((resolve) => {
    const prompt: NicknamePrompt = {
      ...input,
      id: ++promptSequence,
      finish: () => {
        if (useNicknamePrompt.getState().prompt === prompt) useNicknamePrompt.setState({ prompt: null })
        resolve()
      },
    }
    useNicknamePrompt.setState({ prompt })
  })
}
