// @arch docs/architecture/app/chat-attachments-preview.md

import { useCallback, useEffect, useRef, useState } from 'react'
import type { TFunction } from 'i18next'
import { getPreviewFileType } from './filePreviewLanguage'
import { readFilePanelBinaryPreview } from './readFilePanelPreview'
import type { PreviewCacheEntry } from './FileDrawerRow'
import {
  formatSize,
  IMAGE_PREVIEW_MAX_SIZE,
  isImageFile,
  readRemoteImagePreviewBase64,
  type SendFn,
} from './fileOperations'

export type PreviewFile = {
  path: string
  name: string
  size?: number
  modifiedAt?: number
  line?: number
  endLine?: number
}

function isDirectoryPreviewReadError(message?: string | null): boolean {
  return /not a file|eisdir/i.test(String(message || ''))
}

export function useFilePreviewController({
  loadDir,
  previewRequest,
  send,
  t,
}: {
  loadDir: (path: string) => Promise<void>
  previewRequest?: {
    id: number
    path: string
    name: string
    kind?: 'folder'
    line?: number
    endLine?: number
  } | null
  send: SendFn
  t: TFunction
}) {
  const [view, setView] = useState<'list' | 'preview'>('list')
  const [previewFile, setPreviewFile] = useState<PreviewFile | null>(null)
  const [previewContent, setPreviewContent] = useState<string | null>(null)
  const [previewData, setPreviewData] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const [editingMarkdown, setEditingMarkdown] = useState(false)
  const [editDraft, setEditDraft] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const previewCacheRef = useRef<Map<string, PreviewCacheEntry>>(new Map())
  const previewRequestIdRef = useRef(0)
  const activePreviewPathRef = useRef<string | null>(null)

  const openDirectoryList = useCallback(
    (dirPath: string) => {
      previewRequestIdRef.current += 1
      activePreviewPathRef.current = null
      setPreviewFile(null)
      setPreviewContent(null)
      setPreviewData(null)
      setPreviewError('')
      setPreviewLoading(false)
      setEditingMarkdown(false)
      setEditDraft('')
      setView('list')
      void loadDir(dirPath)
    },
    [loadDir],
  )

  const loadFilePreview = useCallback(
    async (file: PreviewFile, options: { force?: boolean } = {}) => {
      const force = options.force === true
      if (force) previewCacheRef.current.delete(file.path)
      const cached = force ? undefined : previewCacheRef.current.get(file.path)
      const activePreviewPath = activePreviewPathRef.current

      setPreviewFile(file)
      setView('preview')

      if (!force && activePreviewPath === file.path) {
        if (cached) {
          setPreviewContent(cached.content)
          setPreviewData(cached.data)
          setPreviewError(cached.error)
          setPreviewLoading(false)
        }
        return
      }

      activePreviewPathRef.current = file.path

      if (cached) {
        setPreviewContent(cached.content)
        setPreviewData(cached.data)
        setPreviewError(cached.error)
        setPreviewLoading(false)
        return
      }

      setPreviewContent(null)
      setPreviewData(null)
      setEditingMarkdown(false)
      setEditDraft('')
      setPreviewLoading(true)
      setPreviewError('')
      const requestId = previewRequestIdRef.current + 1
      previewRequestIdRef.current = requestId

      const fileType = getPreviewFileType(file.name)
      const useBase64 = isImageFile(file.name)
      if (fileType === 'unknown') {
        setPreviewLoading(false)
        return
      }

      try {
        let nextContent: string | null = null
        let nextData: string | null = null

        if (['pdf', 'audio', 'video'].includes(fileType)) {
          nextData = await readFilePanelBinaryPreview(send, file.path, file.name)
        } else if (useBase64) {
          nextData = await readRemoteImagePreviewBase64(
            send,
            file.path,
            (size) =>
              `${t('file_too_large_preview', { size: formatSize(size) })}; max ${formatSize(IMAGE_PREVIEW_MAX_SIZE)}`,
          )
        } else {
          const res = await send({
            type: 'req',
            method: 'fs.read',
            params: { path: file.path, rootPath: file.path, encoding: 'auto' },
          })
          if (requestId !== previewRequestIdRef.current) return

          if (!res.ok) {
            if (isDirectoryPreviewReadError(res.error)) {
              previewCacheRef.current.delete(file.path)
              openDirectoryList(file.path)
              return
            }
            const payload = res.payload as { size?: number } | undefined
            const nextError = payload?.size
              ? `${t('file_too_large_preview', { size: formatSize(payload.size) })}; max ${formatSize(IMAGE_PREVIEW_MAX_SIZE)}`
              : (res.error ?? t('load_dir_failed'))
            setPreviewError(nextError)
            previewCacheRef.current.set(file.path, {
              content: null,
              data: null,
              error: nextError,
            })
            return
          }
          const payload = res.payload as {
            content?: string
            data?: string
            path: string
            size?: number
          }
          nextContent = payload.content ?? null
          nextData = payload.data ?? null
        }
        if (requestId !== previewRequestIdRef.current) return

        previewCacheRef.current.set(file.path, {
          content: nextContent,
          data: nextData,
          error: '',
        })
        setPreviewContent(nextContent)
        setPreviewData(nextData)
        setEditDraft(nextContent ?? '')
        setPreviewError('')
      } catch (error) {
        if (requestId !== previewRequestIdRef.current) return
        const nextError =
          error instanceof Error && error.message ? error.message : t('load_dir_failed')
        if (isDirectoryPreviewReadError(nextError)) {
          previewCacheRef.current.delete(file.path)
          openDirectoryList(file.path)
          return
        }
        setPreviewError(nextError)
        previewCacheRef.current.set(file.path, {
          content: null,
          data: null,
          error: nextError,
        })
      } finally {
        if (requestId === previewRequestIdRef.current) {
          setPreviewLoading(false)
        }
      }
    },
    [openDirectoryList, send, t],
  )

  useEffect(() => {
    if (!previewRequest?.path) return
    if (previewRequest.kind === 'folder') {
      openDirectoryList(previewRequest.path)
      return
    }
    void loadFilePreview({
      path: previewRequest.path,
      name: previewRequest.name,
      line: previewRequest.line,
      endLine: previewRequest.endLine,
    })
  }, [loadFilePreview, openDirectoryList, previewRequest])

  return {
    activePreviewPathRef,
    editDraft,
    editingMarkdown,
    loadFilePreview,
    openDirectoryList,
    previewCacheRef,
    previewContent,
    previewData,
    previewError,
    previewFile,
    previewLoading,
    savingEdit,
    setEditDraft,
    setEditingMarkdown,
    setPreviewContent,
    setPreviewData,
    setPreviewError,
    setPreviewFile,
    setSavingEdit,
    setView,
    view,
  }
}
