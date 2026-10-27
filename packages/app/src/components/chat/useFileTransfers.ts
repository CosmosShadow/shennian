// @arch docs/architecture/app/chat-attachments-preview.md

import { useCallback, useRef, useState } from 'react'
import * as DocumentPicker from 'expo-document-picker'
import { File } from 'expo-file-system'
import { Alert, Platform, type View } from 'react-native'
import type { TFunction } from 'i18next'
import type { FsEntry } from '@shennian/wire'
import {
  archiveRemoteDirectory,
  chunkedUpload,
  guessMimeType,
  isUnsupportedArchiveZipError,
  isWebDownloadCanceled,
  prepareWebDownload,
  readRemoteFileBytes,
  saveNativeBytes,
  uploadFolder,
  type SendFn,
} from './fileOperations'
import { getPreviewFileType } from './filePreviewLanguage'
import {
  getDesktopFilesBridge,
  pickDesktopDirectory,
  pickDesktopFile,
  type DesktopPickedDirectory,
  type DesktopPickedFile,
} from '../../features/desktop-control/desktopFileOperations'
import { useDesktopFileDrop } from '../../features/desktop-control/useDesktopFileDrop'

export type FileTransferNotice = {
  type: 'error' | 'success' | 'info'
  message: string
}

export type FileTransferPreview = {
  path: string
  name: string
}

type MarkdownPdfSetupPayload = {
  code?: string
  skillId?: string
  doctorId?: string
  recommendedRepairActionId?: string
}

class MarkdownPdfSetupRequiredError extends Error {
  setup: MarkdownPdfSetupPayload

  constructor(setup: MarkdownPdfSetupPayload) {
    super('PDF export component is required')
    this.setup = setup
  }
}

function isMarkdownPdfSetupPayload(value: unknown): value is MarkdownPdfSetupPayload {
  const record = value as Record<string, unknown> | null
  return record?.code === 'SKILL_SETUP_REQUIRED' && record.skillId === 'markdown-to-pdf'
}

export function useFileTransfers({
  currentPath,
  readOnly = false,
  allowUpload = !readOnly,
  dropTarget,
  loadDir,
  previewContent,
  previewData,
  previewFile,
  send,
  t,
  workDir,
}: {
  currentPath: string
  readOnly?: boolean
  allowUpload?: boolean
  dropTarget: View | null
  loadDir: (path: string) => Promise<void>
  previewContent: string | null
  previewData: string | null
  previewFile: FileTransferPreview | null
  send: SendFn
  t: TFunction
  workDir: string
}) {
  const [downloadingPath, setDownloadingPath] = useState<string | null>(null)
  const [downloadPct, setDownloadPct] = useState(0)
  const downloadInFlightPathRef = useRef<string | null>(null)
  const [downloadNotice, setDownloadNotice] = useState<FileTransferNotice | null>(null)
  const [uploadPct, setUploadPct] = useState<number | null>(null)
  const visibleDirectoryRef = useRef(currentPath || workDir)
  visibleDirectoryRef.current = currentPath || workDir
  const uploadPickingRef = useRef(false)
  const [uploadLabel, setUploadLabel] = useState<string | null>(null)

  const chooseMarkdownDownloadFormat = useCallback(
    (filename: string): Promise<'markdown' | 'pdf' | null> => {
      if (readOnly || getPreviewFileType(filename) !== 'markdown')
        return Promise.resolve('markdown')
      if (Platform.OS === 'web') {
        if (typeof window === 'undefined') return Promise.resolve('markdown')
        const exportPdf = window.confirm(t('download_markdown_format_prompt', { name: filename }))
        return Promise.resolve(exportPdf ? 'pdf' : 'markdown')
      }
      return new Promise((resolve) => {
        Alert.alert(
          t('download_markdown_format_title'),
          t('download_markdown_format_message', { name: filename }),
          [
            { text: t('cancel'), style: 'cancel', onPress: () => resolve(null) },
            { text: t('download_markdown_source'), onPress: () => resolve('markdown') },
            { text: t('export_pdf'), onPress: () => resolve('pdf') },
          ],
        )
      })
    },
    [readOnly, t],
  )

  const exportMarkdownPdf = useCallback(
    async (file: { path: string; name: string }) => {
      const res = await send({
        type: 'req',
        method: 'fs.export.markdown-pdf',
        params: {
          path: file.path,
          rootPath: currentPath || workDir || file.path,
          title: file.name,
        },
      })
      if (!res.ok) {
        if (isMarkdownPdfSetupPayload(res.payload))
          throw new MarkdownPdfSetupRequiredError(res.payload)
        throw new Error(res.error ?? t('export_pdf_failed'))
      }
      const payload = res.payload as { outputPath: string; entry?: FsEntry }
      return {
        path: payload.outputPath,
        name: file.name.replace(/\.mdx?$/i, '.pdf'),
        isDir: false,
        ...(payload.entry ?? {}),
      } as FsEntry
    },
    [currentPath, send, t, workDir],
  )

  const chooseMarkdownPdfSetupAction = useCallback(
    (filename: string): Promise<'repair' | 'markdown' | null> => {
      if (Platform.OS === 'web') {
        if (typeof window === 'undefined') return Promise.resolve(null)
        const repair = window.confirm(t('pdf_setup_required_prompt', { name: filename }))
        if (repair) return Promise.resolve('repair')
        const fallback = window.confirm(t('pdf_setup_download_markdown_prompt', { name: filename }))
        return Promise.resolve(fallback ? 'markdown' : null)
      }
      return new Promise((resolve) => {
        Alert.alert(
          t('pdf_setup_required_title'),
          t('pdf_setup_required_message', { name: filename }),
          [
            { text: t('cancel'), style: 'cancel', onPress: () => resolve(null) },
            { text: t('download_markdown_source'), onPress: () => resolve('markdown') },
            { text: t('pdf_setup_auto_repair'), onPress: () => resolve('repair') },
          ],
        )
      })
    },
    [t],
  )

  const repairMarkdownPdfSetup = useCallback(
    async (_setup: MarkdownPdfSetupPayload) => {
      setDownloadNotice({ type: 'info', message: t('pdf_setup_repairing') })
      const res = await send({
        type: 'req',
        method: 'fs.export.markdown-pdf.setup',
        params: {},
      })
      if (!res.ok) throw new Error(res.error ?? t('pdf_setup_repair_failed'))
    },
    [send, t],
  )

  const exportMarkdownPdfWithSetup = useCallback(
    async (file: {
      path: string
      name: string
    }): Promise<{ entry: FsEntry; format: 'pdf' | 'markdown' }> => {
      try {
        return { entry: await exportMarkdownPdf(file), format: 'pdf' }
      } catch (error) {
        if (!(error instanceof MarkdownPdfSetupRequiredError)) throw error
        const action = await chooseMarkdownPdfSetupAction(file.name)
        if (action === 'markdown') {
          return { entry: { path: file.path, name: file.name, isDir: false }, format: 'markdown' }
        }
        if (action !== 'repair') throw error
        await repairMarkdownPdfSetup(error.setup)
        setDownloadNotice({ type: 'info', message: t('exporting_pdf', { name: file.name }) })
        return { entry: await exportMarkdownPdf(file), format: 'pdf' }
      }
    },
    [chooseMarkdownPdfSetupAction, exportMarkdownPdf, repairMarkdownPdfSetup, t],
  )

  const saveRemoteFile = useCallback(
    async (entry: FsEntry, preparedWebDownload?: ReturnType<typeof prepareWebDownload>) => {
      const mimeType = guessMimeType(entry.name)
      const bytes = await readRemoteFileBytes(send, entry.path, setDownloadPct)
      if (Platform.OS === 'web') {
        const target = preparedWebDownload ?? prepareWebDownload(entry.name)
        if (!target) throw new Error('Browser download is not available')
        const mode = await target.saveBlob(
          new Blob([bytes as unknown as BlobPart], { type: mimeType }),
        )
        setDownloadNotice({
          type: 'success',
          message:
            mode === 'picker'
              ? t('download_saved_to_selected_location', { name: entry.name })
              : t('download_started_browser', { name: entry.name }),
        })
        return
      }

      const mode = await saveNativeBytes(entry.name, bytes, mimeType)
      setDownloadNotice({
        type: mode === 'downloads' ? 'success' : 'info',
        message:
          mode === 'downloads'
            ? t('download_saved_to_downloads', { name: entry.name })
            : t('download_opened_save_sheet', { name: entry.name }),
      })
    },
    [send, t],
  )

  const downloadFileFromList = useCallback(
    async (entry: FsEntry) => {
      if (downloadInFlightPathRef.current) return
      downloadInFlightPathRef.current = entry.path
      setDownloadingPath(entry.path)
      setDownloadPct(0)
      setDownloadNotice(null)
      try {
        const format = await chooseMarkdownDownloadFormat(entry.name)
        if (!format) return
        let targetEntry = entry
        const webDownload =
          Platform.OS === 'web'
            ? prepareWebDownload(
                format === 'pdf' ? entry.name.replace(/\.mdx?$/i, '.pdf') : entry.name,
              )
            : null
        if (format === 'pdf') {
          setDownloadNotice({ type: 'info', message: t('exporting_pdf', { name: entry.name }) })
          const result = await exportMarkdownPdfWithSetup(entry)
          targetEntry = result.entry
          if (result.format === 'markdown' && Platform.OS === 'web') {
            await saveRemoteFile(targetEntry)
            return
          }
          void loadDir(currentPath || workDir || '~')
        }
        await saveRemoteFile(targetEntry, webDownload)
      } catch (error) {
        setDownloadNotice({
          type: isWebDownloadCanceled(error) ? 'info' : 'error',
          message: isWebDownloadCanceled(error)
            ? t('download_canceled', { name: entry.name })
            : error instanceof Error && error.message
              ? t('download_failed_with_reason', { name: entry.name, reason: error.message })
              : t('download_failed', { name: entry.name }),
        })
      } finally {
        downloadInFlightPathRef.current = null
        setDownloadingPath(null)
        setDownloadPct(0)
      }
    },
    [
      chooseMarkdownDownloadFormat,
      currentPath,
      exportMarkdownPdfWithSetup,
      loadDir,
      saveRemoteFile,
      t,
      workDir,
    ],
  )

  const downloadDirectoryFromList = useCallback(
    async (entry: FsEntry) => {
      if (downloadInFlightPathRef.current) return
      downloadInFlightPathRef.current = entry.path
      setDownloadingPath(entry.path)
      setDownloadPct(0)
      setDownloadNotice({ type: 'info', message: t('creating_zip', { name: entry.name }) })
      try {
        const targetName = `${entry.name.replace(/\.zip$/i, '')}.zip`
        const webDownload = Platform.OS === 'web' ? prepareWebDownload(targetName) : null
        const archiveEntry = await archiveRemoteDirectory(send, entry)
        await saveRemoteFile({ ...archiveEntry, name: targetName, isDir: false }, webDownload)
      } catch (error) {
        setDownloadNotice({
          type: isWebDownloadCanceled(error) ? 'info' : 'error',
          message: isWebDownloadCanceled(error)
            ? t('download_canceled', { name: entry.name })
            : error instanceof Error && error.message
              ? t('download_failed_with_reason', {
                  name: entry.name,
                  reason: isUnsupportedArchiveZipError(error.message)
                    ? t('folder_download_requires_update')
                    : error.message,
                })
              : t('folder_download_failed'),
        })
      } finally {
        downloadInFlightPathRef.current = null
        setDownloadingPath(null)
        setDownloadPct(0)
      }
    },
    [saveRemoteFile, send, t],
  )

  const handleUpload = useCallback(() => {
    if (!allowUpload || uploadPct != null || uploadPickingRef.current) return
    // Capture the destination before opening the picker. Never follow later navigation.
    const targetPath = currentPath || workDir
    const uploaded = async () => {
      if (visibleDirectoryRef.current === targetPath) await loadDir(targetPath)
      setDownloadNotice({ type: 'success', message: t('remote_folder_uploaded_to', { path: targetPath }) })
    }
    if (Platform.OS !== 'web') {
      uploadPickingRef.current = true
      setUploadPct(0)
      void (async () => {
        try {
          const result = await DocumentPicker.getDocumentAsync({
            type: '*/*',
            copyToCacheDirectory: true,
          })
          if (result.canceled) return
          const asset = result.assets[0]
          const file = new File(asset.uri)
          setUploadPct(0)
          setUploadLabel(asset.name)
          const handle = file.open()
          try {
            await chunkedUpload(
              send,
              {
                name: asset.name,
                size: file.size,
                readChunk: async (offset, length) => {
                  handle.offset = offset
                  return handle.readBytes(length)
                },
              },
              targetPath,
              true,
              setUploadPct,
            )
          } finally {
            handle.close()
          }
          await uploaded()
        } catch (error) {
          setDownloadNotice({
            type: 'error',
            message: error instanceof Error ? error.message : t('upload_failed'),
          })
        } finally {
          uploadPickingRef.current = false
          setUploadPct(null)
          setUploadLabel(null)
        }
      })()
      return
    }
    const desktopFiles = getDesktopFilesBridge()
    if (desktopFiles) {
      void pickDesktopFile(desktopFiles)
        .then((file) => {
          if (!file) return
          setUploadPct(0)
          chunkedUpload(send, file, targetPath, true, setUploadPct)
            .then(uploaded)
            .catch((error) =>
              setDownloadNotice({
                type: 'error',
                message: error instanceof Error ? error.message : t('upload_failed'),
              }),
            )
            .finally(() => {
              setUploadPct(null)
              setUploadLabel(null)
            })
        })
        .catch((error) =>
          setDownloadNotice({
            type: 'error',
            message: error instanceof Error ? error.message : t('upload_failed'),
          }),
        )
      return
    }
    const input = document.createElement('input')
    input.type = 'file'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return
      setUploadPct(0)
      chunkedUpload(send, file, targetPath, true, setUploadPct)
        .then(uploaded)
        .catch((error) =>
          setDownloadNotice({
            type: 'error',
            message: error instanceof Error ? error.message : t('upload_failed'),
          }),
        )
        .finally(() => {
          setUploadPct(null)
          setUploadLabel(null)
        })
    }
    input.click()
  }, [allowUpload, uploadPct, send, currentPath, workDir, loadDir, t])

  const handleUploadFolder = useCallback(() => {
    if (Platform.OS !== 'web') return
    const desktopFiles = getDesktopFilesBridge()
    if (desktopFiles) {
      void pickDesktopDirectory(desktopFiles)
        .then((directory) => {
          if (!directory) return
          setUploadPct(0)
          setUploadLabel(t('uploading_folder'))
          const files = directory.files.map((file) => ({
            ...file,
            type: guessMimeType(file.name),
            relativePath: `${directory.name}/${file.relativePath}`,
          }))
          uploadFolder(send, files, currentPath, true, setUploadPct, currentPath)
            .then(() => void loadDir(currentPath))
            .catch((error) =>
              setDownloadNotice({
                type: 'error',
                message: error instanceof Error ? error.message : t('upload_failed'),
              }),
            )
            .finally(() => {
              setUploadPct(null)
              setUploadLabel(null)
            })
        })
        .catch((error) =>
          setDownloadNotice({
            type: 'error',
            message: error instanceof Error ? error.message : t('upload_failed'),
          }),
        )
      return
    }
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.setAttribute('webkitdirectory', '')
    input.setAttribute('directory', '')
    input.onchange = () => {
      const files = Array.from(input.files ?? [])
      if (files.length === 0) return
      setUploadPct(0)
      setUploadLabel(t('uploading_folder'))
      uploadFolder(send, files, currentPath, true, setUploadPct, currentPath)
        .then(() => void loadDir(currentPath))
        .catch((err) => {
          setDownloadNotice({
            type: 'error',
            message: err instanceof Error ? err.message : t('upload_failed'),
          })
        })
        .finally(() => {
          setUploadPct(null)
          setUploadLabel(null)
        })
    }
    input.click()
  }, [currentPath, loadDir, send, t])

  const uploadDroppedFiles = useCallback(
    async (files: DesktopPickedFile[]) => {
      if (uploadPct != null) return
      setUploadPct(0)
      setUploadLabel(null)
      try {
        for (let index = 0; index < files.length; index += 1) {
          const file = files[index]!
          await chunkedUpload(send, file, currentPath, true, (progress) => {
            setUploadPct(Math.round(((index + progress / 100) / files.length) * 100))
          })
        }
        await loadDir(currentPath)
      } catch (error) {
        setDownloadNotice({
          type: 'error',
          message: error instanceof Error ? error.message : t('upload_failed'),
        })
      } finally {
        setUploadPct(null)
        setUploadLabel(null)
      }
    },
    [currentPath, loadDir, send, t, uploadPct],
  )

  const uploadDroppedDirectories = useCallback(
    async (directories: DesktopPickedDirectory[]) => {
      if (uploadPct != null) return
      setUploadPct(0)
      setUploadLabel(t('uploading_folder'))
      try {
        for (let index = 0; index < directories.length; index += 1) {
          const directory = directories[index]!
          const files = directory.files.map((file) => ({
            ...file,
            type: guessMimeType(file.name),
            relativePath: `${directory.name}/${file.relativePath}`,
          }))
          await uploadFolder(
            send,
            files,
            currentPath,
            true,
            (progress) => {
              setUploadPct(Math.round(((index + progress / 100) / directories.length) * 100))
            },
            currentPath,
          )
        }
        await loadDir(currentPath)
      } catch (error) {
        setDownloadNotice({
          type: 'error',
          message: error instanceof Error ? error.message : t('upload_failed'),
        })
      } finally {
        setUploadPct(null)
        setUploadLabel(null)
      }
    },
    [currentPath, loadDir, send, t, uploadPct],
  )

  useDesktopFileDrop(uploadDroppedFiles, uploadPct == null, {
    onDirectories: uploadDroppedDirectories,
    onError: (error) =>
      setDownloadNotice({
        type: 'error',
        message: error instanceof Error ? error.message : t('upload_failed'),
      }),
    target: dropTarget,
  })

  const handleDownload = useCallback(() => {
    if (!previewFile) return
    const file = previewFile
    if (['pdf', 'audio', 'video'].includes(getPreviewFileType(file.name))) {
      void downloadFileFromList({ ...file, isDir: false })
      return
    }
    if (downloadInFlightPathRef.current) return
    downloadInFlightPathRef.current = file.path
    setDownloadNotice(null)
    void chooseMarkdownDownloadFormat(file.name)
      .then(async (format) => {
        if (!format) return
        const targetName = format === 'pdf' ? file.name.replace(/\.mdx?$/i, '.pdf') : file.name
        const webDownload = Platform.OS === 'web' ? prepareWebDownload(targetName) : null
        if (
          format === 'markdown' &&
          Platform.OS === 'web' &&
          (previewContent != null || previewData != null)
        ) {
          const mimeType = guessMimeType(file.name)
          const blob = previewData
            ? new Blob([Uint8Array.from(atob(previewData), (char) => char.charCodeAt(0))], {
                type: mimeType,
              })
            : new Blob([previewContent || ''], { type: mimeType })
          const target = webDownload ?? prepareWebDownload(file.name)
          if (!target) throw new Error('Browser download is not available')
          const mode = await target.saveBlob(blob)
          setDownloadNotice({
            type: 'success',
            message:
              mode === 'picker'
                ? t('download_saved_to_selected_location', { name: file.name })
                : t('download_started_browser', { name: file.name }),
          })
          return
        }

        setDownloadingPath(file.path)
        setDownloadPct(0)
        let targetEntry: FsEntry = { path: file.path, name: file.name, isDir: false }
        if (format === 'pdf') {
          setDownloadNotice({ type: 'info', message: t('exporting_pdf', { name: file.name }) })
          const result = await exportMarkdownPdfWithSetup(targetEntry)
          targetEntry = result.entry
          if (result.format === 'markdown' && Platform.OS === 'web') {
            if (previewContent != null || previewData != null) {
              const mimeType = guessMimeType(file.name)
              const blob = previewData
                ? new Blob([Uint8Array.from(atob(previewData), (char) => char.charCodeAt(0))], {
                    type: mimeType,
                  })
                : new Blob([previewContent || ''], { type: mimeType })
              const target = prepareWebDownload(file.name)
              if (!target) throw new Error('Browser download is not available')
              const mode = await target.saveBlob(blob)
              setDownloadNotice({
                type: 'success',
                message:
                  mode === 'picker'
                    ? t('download_saved_to_selected_location', { name: file.name })
                    : t('download_started_browser', { name: file.name }),
              })
              return
            }
            await saveRemoteFile(targetEntry)
            return
          }
          void loadDir(currentPath || workDir || '~')
        }
        await saveRemoteFile(targetEntry, webDownload)
      })
      .catch((error) => {
        setDownloadNotice({
          type: isWebDownloadCanceled(error) ? 'info' : 'error',
          message: isWebDownloadCanceled(error)
            ? t('download_canceled', { name: file.name })
            : error instanceof Error && error.message
              ? t('download_failed_with_reason', { name: file.name, reason: error.message })
              : t('download_failed', { name: file.name }),
        })
      })
      .finally(() => {
        downloadInFlightPathRef.current = null
        setDownloadingPath(null)
        setDownloadPct(0)
      })
  }, [
    chooseMarkdownDownloadFormat,
    currentPath,
    downloadFileFromList,
    exportMarkdownPdfWithSetup,
    loadDir,
    previewContent,
    previewData,
    previewFile,
    saveRemoteFile,
    t,
    workDir,
  ])

  return {
    downloadDirectoryFromList,
    downloadFileFromList,
    downloadNotice,
    downloadPct,
    downloadingPath,
    handleDownload,
    handleUpload,
    handleUploadFolder,
    setDownloadNotice,
    uploadLabel,
    uploadPct,
  }
}
