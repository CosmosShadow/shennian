// @arch docs/architecture/app/chat-attachments-preview.md
// @arch docs/features/desktop-local-first-client.md#84-desktop-文件夹上传
// @test src/__tests__/chat-attachments.test.ts

import { useCallback, useEffect, useRef, useState } from 'react'
import { Platform } from 'react-native'
import { useMachinesStore } from '@shennian/shared'
import * as DocumentPicker from 'expo-document-picker'
import * as Crypto from 'expo-crypto'
import { File as ExpoFile } from 'expo-file-system'
import * as ImagePicker from 'expo-image-picker'
import { accountRuntime } from '../../account-runtime/accountRuntime'
import {
  buildAttachmentMeta,
  extractClipboardImageFiles,
  inferMimeTypeFromName,
} from '../utils/attachments'
import {
  cacheImageAttachmentPreview,
  cacheLocalImageAttachmentPreview,
} from '../utils/attachmentPreview'
import {
  abortPersonalAttachmentUpload,
  uploadPersonalAttachment,
} from '../utils/personalAttachmentTransfer'
import {
  getDesktopFilesBridge,
  pickDesktopDirectory,
  pickDesktopFile,
} from '../../desktop-control/desktopFileOperations'
import { useDesktopFileDrop } from '../../desktop-control/useDesktopFileDrop'
import { isInlineImage } from '../../uploads/heicFile'

type AttachmentTransferMethod =
  | 'fs.transfer.start'
  | 'fs.transfer.chunk'
  | 'fs.transfer.finish'
  | 'fs.transfer.abort'

function sendAttachmentTransfer(
  machineId: string,
  frame: { type: 'req'; method: AttachmentTransferMethod; params: Record<string, unknown> },
  timeoutMs?: number,
) {
  return accountRuntime.requestMachine(machineId, frame.method, frame.params, {
    responseTimeoutMs: timeoutMs,
    connectTimeoutMs: 15_000,
  })
}

export type UploadTask = {
  id: string
  path: string
  name: string
  mimeType: string
  kind: 'image' | 'file' | 'folder'
  progress: number
  previewData?: string
  transferId?: string
  aborted?: boolean
  byteSize?: number
  sha256?: string
}

type Options = {
  machineId: string | null
  workDir: string
  enabled?: boolean
}

type UploadSourceFile = {
  uri?: string
  name: string
  size: number
  mimeType: string
  base64Data?: string
  relativePath?: string
  readBytes?: () => Promise<Uint8Array>
}

type NativeMediaAssetNameInput = {
  fileName?: string | null
  type?: 'image' | 'video' | 'livePhoto' | 'pairedVideo' | null
  mimeType?: string | null
}

function inferNativeMediaFallbackExt(asset: Pick<NativeMediaAssetNameInput, 'type' | 'mimeType'>): string {
  const mimeType = asset.mimeType?.toLowerCase() ?? ''
  switch (mimeType) {
    case 'image/png':
      return 'png'
    case 'image/gif':
      return 'gif'
    case 'image/webp':
      return 'webp'
    case 'image/heic':
      return 'heic'
    case 'image/heif':
      return 'heif'
    case 'video/quicktime':
      return 'mov'
    case 'video/webm':
      return 'webm'
    case 'video/x-msvideo':
      return 'avi'
    case 'video/mp4':
      return 'mp4'
    default:
      return asset.type === 'video' ? 'mp4' : 'jpg'
  }
}

function buildNativeMediaFallbackName(
  asset: NativeMediaAssetNameInput,
  stamp: number,
  index: number,
): string {
  if (asset.fileName) return asset.fileName
  const isVideo = asset.type === 'video' || asset.mimeType?.toLowerCase().startsWith('video/')
  const prefix = isVideo ? 'video' : 'image'
  const ext = inferNativeMediaFallbackExt(asset)
  return `${prefix}_${stamp}_${index + 1}.${ext}`
}

const UPLOAD_TIMEOUT = 600_000

function decodeBase64(value: string): Uint8Array {
  const normalized = value.trim().replace(/^data:[^,]*;base64,/, '')
  const binary = atob(normalized)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 16 * 1024) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + 16 * 1024)))
  }
  return btoa(binary)
}

export function useChatUploads({ machineId, workDir, enabled = true }: Options) {
  const [pendingAttachments, setPendingAttachments] = useState<UploadTask[]>([])
  const uploadTasksRef = useRef<UploadTask[]>([])
  const abortedTransferIdsRef = useRef(new Set<string>())
  uploadTasksRef.current = pendingAttachments
  const machineOnline = useMachinesStore((state) =>
    machineId ? state.machines.find((machine) => machine.id === machineId)?.online === true : false,
  )
  const daemonInstallationId = useMachinesStore((state) =>
    machineId
      ? state.machines.find((machine) => machine.id === machineId)?.daemonInstallationId ?? null
      : null,
  )

  const isUploading = pendingAttachments.some((task) => task.progress < 1)

  const readFileBytes = useCallback(async (file: UploadSourceFile): Promise<Uint8Array> => {
    if (file.readBytes) return file.readBytes()
    if (file.base64Data) return decodeBase64(file.base64Data)
    if (!file.uri) throw new Error('Missing upload data')
    if (Platform.OS === 'web') {
      const response = await fetch(file.uri)
      return new Uint8Array(await response.arrayBuffer())
    }
    return new Uint8Array(await new ExpoFile(file.uri).arrayBuffer())
  }, [])

  const cancelUpload = useCallback(
    (taskId: string) => {
      const task = uploadTasksRef.current.find((item) => item.id === taskId)
      if (!task) return
      if (task.transferId) abortedTransferIdsRef.current.add(task.transferId)
      setPendingAttachments((prev) =>
        prev.map((item) => (item.id === taskId ? { ...item, aborted: true } : item)),
      )
      if (task.transferId && machineId && daemonInstallationId) {
        void abortPersonalAttachmentUpload({
          send: sendAttachmentTransfer,
          machineId,
          daemonInstallationId: daemonInstallationId!,
          rootPath: workDir,
          transferId: task.transferId,
          timeoutMs: UPLOAD_TIMEOUT,
        }).catch(() => {})
      }
      setPendingAttachments((prev) => prev.filter((item) => item.id !== taskId))
    },
    [daemonInstallationId, machineId, workDir],
  )

  const uploadOneFile = useCallback(
    async (
      file: UploadSourceFile,
      task: UploadTask,
    ) => {
      if (!machineId || !daemonInstallationId) return
      let transferId: string | null = null

      try {
        if (!task.transferId) throw new Error('Missing transfer ID')
        transferId = task.transferId
        const localPreviewPromise =
          task.kind === 'image' && Platform.OS !== 'web' && file.uri
            ? cacheLocalImageAttachmentPreview(machineId, task, file.uri)
            : null
        const bytes = await readFileBytes(file)
        if (file.size > 0 && file.size !== bytes.byteLength) throw new Error('Attachment size changed')
        if (uploadTasksRef.current.find((item) => item.id === task.id)?.aborted) return
        if (task.kind === 'image') {
          if (Platform.OS === 'web') cacheImageAttachmentPreview(machineId, task, encodeBase64(bytes))
        }
        const previewData = localPreviewPromise
          ? await localPreviewPromise
          : task.kind === 'image' ? encodeBase64(bytes) : undefined
        setPendingAttachments((prev) =>
          prev.map((item) =>
            item.id === task.id && item.kind === 'image'
              ? { ...item, previewData: previewData ?? undefined }
              : item,
          ),
        )

        const result = await uploadPersonalAttachment({
          send: sendAttachmentTransfer,
          machineId,
          daemonInstallationId,
          rootPath: workDir,
          transferId: task.transferId,
          name: file.name,
          mimeType: file.mimeType,
          kind: 'file',
          files: [{ bytes, mimeType: file.mimeType }],
          timeoutMs: UPLOAD_TIMEOUT,
          isAborted: () => abortedTransferIdsRef.current.has(task.transferId!),
          onProgress: (progress) => setPendingAttachments((prev) =>
            prev.map((item) => (item.id === task.id ? { ...item, progress } : item)),
          ),
        })
        setPendingAttachments((prev) =>
          prev.map((item) => item.id === task.id ? {
            ...item,
            path: result.path,
            name: result.name,
            mimeType: result.mimeType,
            kind: isInlineImage(result) ? 'image' : 'file',
            byteSize: result.byteSize,
            sha256: result.sha256,
            progress: 1,
          } : item),
        )
      } catch {
        if (transferId && abortedTransferIdsRef.current.has(transferId)) return
        setPendingAttachments((prev) => prev.filter((item) => item.id !== task.id))
      }
    },
    [daemonInstallationId, machineId, readFileBytes, workDir],
  )

  const startUploads = useCallback(
    (files: UploadSourceFile[]) => {
      if (!enabled || !machineId || !daemonInstallationId || !machineOnline || files.length === 0) return false
      for (const file of files) {
        const taskId = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
        const attachment = buildAttachmentMeta({
          path: `${workDir.replace(/[/\\]+$/, '')}/.uploads/${file.name}`,
          name: file.name,
          mimeType: file.mimeType,
        })
        const transferId = `attachment_${Crypto.randomUUID()}`
        const task: UploadTask = {
          id: taskId,
          path: attachment.path,
          name: attachment.name,
          mimeType: attachment.mimeType,
          kind: attachment.kind,
          progress: 0,
          transferId,
        }
        setPendingAttachments((prev) => [...prev, task])
        void uploadOneFile(file, task)
      }
      return true
    },
    [daemonInstallationId, enabled, machineId, machineOnline, uploadOneFile, workDir],
  )

  const handleAttachWeb = useCallback(() => {
    if (Platform.OS !== 'web' || !machineId || !daemonInstallationId || !machineOnline) return
    const desktopFiles = getDesktopFilesBridge()
    if (desktopFiles) {
      void pickDesktopFile(desktopFiles)
        .then((file) => {
          if (!file) return
          startUploads([{
            name: file.name,
            mimeType: inferMimeTypeFromName(file.name),
            size: file.size,
            readBytes: file.readBytes,
          }])
        })
        .catch(() => {})
      return
    }
    const fileInput = document.createElement('input')
    fileInput.type = 'file'
    fileInput.multiple = true
    fileInput.onchange = () => {
      const rawFiles = fileInput.files
      if (!rawFiles || rawFiles.length === 0) return
      const files = Array.from(rawFiles).map((file) => ({
        uri: URL.createObjectURL(file),
        name: file.name,
        mimeType: file.type || inferMimeTypeFromName(file.name),
        size: file.size,
      }))
      startUploads(files)
    }
    fileInput.click()
  }, [daemonInstallationId, machineId, machineOnline, startUploads])

  const startFolderUpload = useCallback((folderName: string, files: UploadSourceFile[]) => {
    if (!machineId || files.length === 0) return
    const taskId = `upload-folder-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const transferId = `attachment_${Crypto.randomUUID()}`
    const folderPath = `${workDir.replace(/[/\\]+$/, '')}/.uploads/${folderName}`
    setPendingAttachments((prev) => [
      ...prev,
      {
        id: taskId,
        path: folderPath,
        name: folderName,
        mimeType: 'inode/directory',
        kind: 'folder',
        progress: 0,
        transferId,
      },
    ])
    void (async () => {
      const prepared = await Promise.all(files.map(async (file) => ({
        bytes: await readFileBytes(file),
        mimeType: file.mimeType,
        relativePath: file.relativePath,
      })))
      const result = await uploadPersonalAttachment({
        send: sendAttachmentTransfer,
        machineId,
        daemonInstallationId: daemonInstallationId!,
        rootPath: workDir,
        transferId,
        name: folderName,
        mimeType: 'inode/directory',
        kind: 'folder',
        files: prepared,
        timeoutMs: UPLOAD_TIMEOUT,
        isAborted: () => abortedTransferIdsRef.current.has(transferId),
        onProgress: (progress) => setPendingAttachments((prev) =>
          prev.map((item) => (item.id === taskId ? { ...item, progress } : item)),
        ),
      })
      setPendingAttachments((prev) =>
        prev.map((task) => task.id === taskId ? {
          ...task,
          path: result.path,
          byteSize: result.byteSize,
          sha256: result.sha256,
          progress: 1,
        } : task),
      )
    })().catch(() => {
      if (abortedTransferIdsRef.current.has(transferId)) return
      setPendingAttachments((prev) => prev.filter((task) => task.id !== taskId))
    })
  }, [daemonInstallationId, machineId, readFileBytes, workDir])

  useDesktopFileDrop(
    (files) => void startUploads(files.map((file) => ({
      name: file.name,
      mimeType: inferMimeTypeFromName(file.name),
      size: file.size,
      readBytes: file.readBytes,
    }))),
    Boolean(machineId && daemonInstallationId && machineOnline),
    {
      onDirectories: (directories) => {
        for (const directory of directories) {
          startFolderUpload(directory.name, directory.files.map((file) => ({
            name: file.name,
            mimeType: inferMimeTypeFromName(file.name),
            size: file.size,
            relativePath: file.relativePath,
            readBytes: file.readBytes,
          })))
        }
      },
    },
  )

  const handleAttachFolderWeb = useCallback(() => {
    if (Platform.OS !== 'web' || !machineId) return
    const desktopFiles = getDesktopFilesBridge()
    if (desktopFiles) {
      void pickDesktopDirectory(desktopFiles).then((directory) => {
        if (!directory) return
        startFolderUpload(directory.name, directory.files.map((file) => ({
          name: file.name,
          mimeType: inferMimeTypeFromName(file.name),
          size: file.size,
          relativePath: file.relativePath,
          readBytes: file.readBytes,
        })))
      }).catch(() => {})
      return
    }
    const fileInput = document.createElement('input')
    fileInput.type = 'file'
    fileInput.multiple = true
    fileInput.setAttribute('webkitdirectory', '')
    fileInput.setAttribute('directory', '')
    fileInput.onchange = () => {
      const rawFiles = Array.from(fileInput.files ?? [])
      if (rawFiles.length === 0) return
      const folderName = ((rawFiles[0] as File & { webkitRelativePath?: string }).webkitRelativePath || rawFiles[0].name).split('/')[0] || 'folder'
      startFolderUpload(folderName, rawFiles.map((file) => {
        const rel = ((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name).split('/').slice(1).join('/') || file.name
        return {
          uri: URL.createObjectURL(file),
          name: file.name,
          mimeType: file.type || inferMimeTypeFromName(file.name),
          size: file.size,
          relativePath: rel,
        }
      }))
    }
    fileInput.click()
  }, [machineId, startFolderUpload])

  const handlePasteWeb = useCallback(
    (event: ClipboardEvent) => {
      if (Platform.OS !== 'web' || !machineId) return false
      const files = extractClipboardImageFiles(event.clipboardData)
      if (files.length === 0) return false
      event.preventDefault()
      startUploads(files)
      return true
    },
    [machineId, startUploads],
  )

  const handleAttachNativeFile = useCallback(async () => {
    if (Platform.OS === 'web' || !machineId) return
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
        multiple: true,
      })
      if (result.canceled || result.assets.length === 0) return
      const files = result.assets.map((file) => ({
        uri: file.uri,
        name: file.name,
        mimeType: file.mimeType ?? inferMimeTypeFromName(file.name),
        size: file.size ?? 0,
      }))
      startUploads(files)
    } catch {
      // User cancelled or permissions were denied.
    }
  }, [machineId, startUploads])

  const handleAttachNativeMedia = useCallback(async () => {
    if (Platform.OS === 'web' || !machineId) return
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
      if (status !== 'granted') return
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        allowsMultipleSelection: true,
        quality: 0.85,
      })
      if (result.canceled || result.assets.length === 0) return
      const stamp = Date.now()
      const files = result.assets.map((file, index) => {
        const name = buildNativeMediaFallbackName(file, stamp, index)
        return {
          uri: file.uri,
          name,
          mimeType: file.mimeType ?? inferMimeTypeFromName(name),
          // The picker may transcode/compress media after reporting fileSize.
          // The transfer hashes and verifies the bytes actually read below.
          size: 0,
        }
      })
      startUploads(files)
    } catch {
      // User cancelled or permissions were denied.
    }
  }, [machineId, startUploads])

  const handleTakeNativePhoto = useCallback(async () => {
    if (Platform.OS === 'web' || !machineId) return
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync()
      if (!permission.granted) return
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.85 })
      if (result.canceled || !result.assets[0]) return
      const file = result.assets[0]
      const name = buildNativeMediaFallbackName(file, Date.now(), 0)
      startUploads([{ uri: file.uri, name, mimeType: file.mimeType ?? inferMimeTypeFromName(name), size: 0 }])
    } catch {
      // User cancelled or camera permission was denied.
    }
  }, [machineId, startUploads])

  const replacePendingAttachments = useCallback((tasks: UploadTask[]) => {
    setPendingAttachments(tasks)
  }, [])

  const clearPendingAttachments = useCallback(() => {
    setPendingAttachments([])
  }, [])

  useEffect(() => {
    const abortActiveTransfers = (updateState: boolean) => {
      const tasks = uploadTasksRef.current
      for (const task of tasks) {
        if (!task.transferId || task.progress >= 1) continue
        abortedTransferIdsRef.current.add(task.transferId)
        if (!machineId || !daemonInstallationId) continue
        void abortPersonalAttachmentUpload({
          send: sendAttachmentTransfer,
          machineId,
          daemonInstallationId,
          rootPath: workDir,
          transferId: task.transferId,
          timeoutMs: UPLOAD_TIMEOUT,
        }).catch(() => {})
      }
      if (updateState) setPendingAttachments([])
    }
    if (!enabled) abortActiveTransfers(true)
    return () => abortActiveTransfers(false)
  }, [daemonInstallationId, enabled, machineId, workDir])

  return {
    uploadSelectedFiles: startUploads,
    uploadTasks: pendingAttachments,
    pendingAttachments,
    isUploading,
    cancelUpload,
    handleAttachWeb,
    handleAttachFolderWeb,
    handlePasteWeb,
    handleAttachNativeFile,
    handleAttachNativeMedia,
    handleTakeNativePhoto,
    replacePendingAttachments,
    clearPendingAttachments,
  }
}
