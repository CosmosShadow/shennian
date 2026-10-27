// @arch docs/architecture/mobile-navigation.md
import { createContext, useCallback, useContext, useState, type Dispatch, type SetStateAction } from 'react'
export type DirectoryUploadAction = { path: string; disabled: boolean; onPress: () => void }
export const ContextualStewardContext = createContext<{
  directoryUpload?: DirectoryUploadAction
  setDirectoryUpload?: Dispatch<SetStateAction<DirectoryUploadAction | undefined>>
  draft: (text: string) => void
  setDetails: Dispatch<SetStateAction<Record<string, string>>>
} | null>(null)
export const useContextualSteward = () => useContext(ContextualStewardContext)
export function useContextualStewardDraft(scope = '') {
  const [upload, setUpload] = useState<{ scope: string; action?: DirectoryUploadAction }>({ scope })
  const setDirectoryUpload = useCallback<Dispatch<SetStateAction<DirectoryUploadAction | undefined>>>(next => setUpload(previous => ({
    scope, action: typeof next === 'function' ? next(previous.scope === scope ? previous.action : undefined) : next,
  })), [scope])
  const [state, setState] = useState<{ scope: string; request?: { id: number; text: string }; details: Record<string, string> }>({ scope, details: {} })
  const draft = useCallback((text: string) => setState(previous => ({
    scope, details: previous.scope === scope ? previous.details : {}, request: { id: Date.now(), text },
  })), [scope])
  const setDetails = useCallback<Dispatch<SetStateAction<Record<string, string>>>>(next => setState(previous => ({
    scope, request: previous.scope === scope ? previous.request : undefined,
    details: typeof next === 'function' ? next(previous.scope === scope ? previous.details : {}) : next,
  })), [scope])
  return { directoryUpload: upload.scope === scope ? upload.action : undefined, setDirectoryUpload, details: state.scope === scope ? state.details : {}, request: state.scope === scope ? state.request : undefined, draft, setDetails }
}
