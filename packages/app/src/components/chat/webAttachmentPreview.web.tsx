// @arch docs/architecture/app/chat-attachments-preview.md#3-渲染与预览
// @test src/__tests__/chat-web-attachment-preview.test.ts

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'
import type { ChatAttachment } from '@shennian/shared'

export type WebAttachmentPreviewRequest = (request: {
  path: string
  name?: string
  mimeType?: string
}) => Promise<string | null>

type PreviewContextValue = {
  rootRef: RefObject<HTMLDivElement | null>
  request?: WebAttachmentPreviewRequest
}

const PreviewContext = createContext<PreviewContextValue | null>(null)

export function WebAttachmentPreviewProvider({
  rootRef,
  request,
  children,
}: PreviewContextValue & { children: ReactNode }) {
  const value = useMemo(() => ({ rootRef, request }), [request, rootRef])
  return <PreviewContext.Provider value={value}>{children}</PreviewContext.Provider>
}

type IntersectionObserverLike = {
  observe: (node: Element) => void
  disconnect: () => void
}

type IntersectionObserverConstructor = new (
  callback: (entries: Array<{ isIntersecting: boolean }>) => void,
  options: { root: Element | null; rootMargin: string },
) => IntersectionObserverLike

export function observeWebAttachmentNearViewport(
  node: Element,
  root: Element | null,
  onVisible: () => void,
  Observer: IntersectionObserverConstructor | undefined = globalThis.IntersectionObserver,
): () => void {
  if (!Observer) {
    onVisible()
    return () => {}
  }
  let requested = false
  const observer = new Observer(
    (entries) => {
      if (requested || !entries.some((entry) => entry.isIntersecting)) return
      requested = true
      observer.disconnect()
      onVisible()
    },
    { root, rootMargin: '320px 0px' },
  )
  observer.observe(node)
  return () => observer.disconnect()
}

function asImageSource(value: string, mimeType: string): string {
  return /^(?:data:|file:|blob:|https?:)/i.test(value)
    ? value
    : `data:${mimeType || 'image/png'};base64,${value}`
}

export type WebAttachmentRequestGate = {
  request: (path: string, load: () => Promise<string | null>) => Promise<string | null>
  reset: (path: string) => void
}

export function createWebAttachmentRequestGate(): WebAttachmentRequestGate {
  let currentPath = ''
  let inFlight: Promise<string | null> | null = null
  return {
    request(path, load) {
      if (currentPath === path && inFlight) return inFlight
      currentPath = path
      inFlight = load()
      return inFlight
    },
    reset(path) {
      if (currentPath === path) return
      currentPath = path
      inFlight = null
    },
  }
}

export function useWebAttachmentPreview(attachment: ChatAttachment) {
  const context = useContext(PreviewContext)
  const nodeRef = useRef<HTMLButtonElement>(null)
  const requestGateRef = useRef(createWebAttachmentRequestGate())
  const mountedRef = useRef(true)
  const currentPathRef = useRef(attachment.path)
  const [previewSource, setPreviewSource] = useState(() =>
    attachment.previewData ? asImageSource(attachment.previewData, attachment.mimeType) : null,
  )

  useEffect(() => {
    currentPathRef.current = attachment.path
    requestGateRef.current.reset(attachment.path)
    setPreviewSource(
      attachment.previewData ? asImageSource(attachment.previewData, attachment.mimeType) : null,
    )
  }, [attachment.mimeType, attachment.path, attachment.previewData])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    const node = nodeRef.current
    const rootRef = context?.rootRef
    const request = context?.request
    if (attachment.kind !== 'image' || previewSource || !node || !request || !rootRef) return
    return observeWebAttachmentNearViewport(node, rootRef.current, () => {
      const path = attachment.path
      void requestGateRef.current
        .request(path, () =>
          request({
            path,
            name: attachment.name,
            mimeType: attachment.mimeType,
          }),
        )
        .then((result) => {
          if (mountedRef.current && currentPathRef.current === path && result) {
            setPreviewSource(asImageSource(result, attachment.mimeType))
          }
        })
        .catch(() => {})
    })
  }, [
    attachment.kind,
    attachment.mimeType,
    attachment.name,
    attachment.path,
    context?.request,
    context?.rootRef,
    previewSource,
  ])

  return { nodeRef, previewSource }
}
