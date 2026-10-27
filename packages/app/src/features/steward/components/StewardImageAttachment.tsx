// @arch docs/architecture/app/chat-attachments-preview.md
// @test src/__tests__/steward-image-attachment.test.ts
import { useEffect, useState } from 'react'
import { Image, Pressable, Text } from 'react-native'
import type { ChatAttachment } from '@shennian/shared'

export type StewardImagePreviewRequest = (request: { path: string; name?: string; mimeType?: string }) => Promise<string | null>

// Only attachment metadata is eligible for inline preview. Never fetch arbitrary
// Markdown URLs; history is loaded through the existing authenticated machine reader.
export function StewardImageAttachment({ attachment, requestPreview, onOpen }: {
  attachment: ChatAttachment
  requestPreview?: StewardImagePreviewRequest
  onOpen?: (path: string) => void
}) {
  const { path, name, mimeType, previewData } = attachment
  const [loaded, setLoaded] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let cancelled = false
    setLoaded(null)
    setFailed(false)
    if (!previewData && requestPreview) {
      void requestPreview({ path, name, mimeType }).then(data => {
        if (!cancelled) setLoaded(data)
      }).catch(() => { /* The file remains openable if the machine is offline. */ })
    }
    return () => { cancelled = true }
  }, [path, name, mimeType, previewData, requestPreview])
  const data = previewData || loaded
  const uri = data && (/^(?:data:|file:|blob:|https?:)/i.test(data) ? data : `data:${mimeType};base64,${data}`)
  return <Pressable accessibilityRole="button" accessibilityLabel={name} onPress={() => onOpen?.(path)} style={{ marginVertical: 4 }}>
    {uri && !failed ? <Image source={{ uri }} accessibilityLabel={name}
      style={{ width: 220, height: 180, borderRadius: 8 }} resizeMode="contain" onError={() => setFailed(true)} />
      : <Text>{name}</Text>}
  </Pressable>
}
