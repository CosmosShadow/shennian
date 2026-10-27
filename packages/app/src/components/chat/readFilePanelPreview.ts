// @arch docs/architecture/app/chat-attachments-preview.md
// @test packages/app/src/__tests__/file-preview-language.test.ts
import { Platform } from 'react-native'
import { getPreviewFileType } from './filePreviewLanguage'
import { guessMimeType, IMAGE_PREVIEW_MAX_SIZE, type SendFn } from './fileOperations'

/** Binary preview uses bounded chunks; native PDFs stay on disk rather than in React state. */
export async function readFilePanelBinaryPreview(
  send: SendFn,
  path: string,
  name: string,
): Promise<string> {
  const readChunk = async (offset: number) => {
    const response = await send({
      type: 'req',
      method: 'fs.read',
      params: {
        path,
        rootPath: path,
        encoding: 'base64',
        offset,
        length: 768 * 1024,
      },
    })
    if (!response.ok) throw new Error(response.error || 'Unable to load preview')
    return response.payload as { data?: string; length?: number; totalSize?: number }
  }
  if (Platform.OS !== 'web' && getPreviewFileType(name) === 'pdf') {
    const { loadNativePdfPreview } =
      await import('../../features/chat/utils/nativeImagePreviewCache')
    return loadNativePdfPreview({
      cacheKey: `file-panel:${path}`,
      maxSize: IMAGE_PREVIEW_MAX_SIZE,
      refresh: true,
      readChunk,
    })
  }
  let offset = 0
  let total: number | undefined
  const chunks: string[] = []
  while (total == null || offset < total) {
    const chunk = await readChunk(offset)
    if (chunk.totalSize == null || chunk.totalSize > IMAGE_PREVIEW_MAX_SIZE || chunk.totalSize < 0)
      throw new Error('Preview exceeds 20 MB')
    if (total != null && total !== chunk.totalSize) throw new Error('File changed during preview')
    total = chunk.totalSize
    const length = chunk.length ?? 0
    const data = chunk.data ?? ''
    if (length <= 0 || atob(data).length !== length || offset + length > total)
      throw new Error('Incomplete preview')
    chunks.push(data)
    offset += length
    if (offset < total && length % 3 !== 0) throw new Error('Invalid preview chunk')
  }
  return `data:${guessMimeType(name)};base64,${chunks.join('')}`
}
