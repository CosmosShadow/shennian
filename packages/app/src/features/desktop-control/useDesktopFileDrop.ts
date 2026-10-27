// @arch docs/features/desktop-local-first-client.md#71-desktop-bridge-ipcrenderer--main
// @test packages/app/src/__tests__/desktop-file-operations.test.ts

import { useEffect, useRef } from 'react'
import { Platform } from 'react-native'
import {
  adoptDesktopDroppedItem,
  getDesktopFilesBridge,
  splitDesktopPickedItems,
  type DesktopPickedDirectory,
  type DesktopPickedFile,
} from './desktopFileOperations'

type DesktopFileDropOptions = {
  onDirectories?: (directories: DesktopPickedDirectory[]) => void | Promise<void>
  onError?: (error: unknown) => void
  target?: unknown
}

export function useDesktopFileDrop(
  onFiles: (files: DesktopPickedFile[]) => void | Promise<void>,
  enabled = true,
  options: DesktopFileDropOptions = {},
): void {
  const callbackRef = useRef(onFiles)
  const optionsRef = useRef(options)
  callbackRef.current = onFiles
  optionsRef.current = options

  useEffect(() => {
    if (!enabled || Platform.OS !== 'web' || typeof document === 'undefined') return
    const bridge = getDesktopFilesBridge()
    if (!bridge) return

    const onDragOver = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
    }
    const onDrop = (event: Event) => {
      const dragEvent = event as DragEvent
      const files = droppedItems(dragEvent.dataTransfer)
      if (files.length === 0) return
      dragEvent.preventDefault()
      dragEvent.stopPropagation()
      void Promise.all(files.map((file) => adoptDesktopDroppedItem(file, bridge)))
        .then(async (picked) => {
          const { files: regularFiles, directories } = splitDesktopPickedItems(picked)
          if (regularFiles.length > 0) await callbackRef.current(regularFiles)
          if (directories.length > 0) await optionsRef.current.onDirectories?.(directories)
        })
        .catch((error) => optionsRef.current.onError?.(error))
    }
    const target = optionsRef.current.target
    const eventTarget = target && typeof (target as EventTarget).addEventListener === 'function'
      ? target as EventTarget
      : document
    eventTarget.addEventListener('dragover', onDragOver as EventListener)
    eventTarget.addEventListener('drop', onDrop)
    return () => {
      eventTarget.removeEventListener('dragover', onDragOver as EventListener)
      eventTarget.removeEventListener('drop', onDrop)
    }
  }, [enabled, options.target])
}

function droppedItems(dataTransfer: DataTransfer | null): File[] {
  if (!dataTransfer) return []
  const itemFiles = Array.from(dataTransfer.items ?? [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null)
  return itemFiles.length > 0 ? itemFiles : Array.from(dataTransfer.files ?? [])
}
