// @arch open-source/docs/cli-runtime.md
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { ChatAttachmentMeta } from '@shennian/wire'
import type { HttpPublicAgentDeliveryClient, PublicAgentClaim } from './public-delivery-client.js'

const MAX_TOTAL = 100 * 1024 * 1024

/** Fetch only leased, server-issued files into a temporary directory for this turn. */
export async function materializePublicAttachments(input: {
  claim: PublicAgentClaim; machineToken: string; workDir: string
  delivery: Pick<HttpPublicAgentDeliveryClient, 'attachment'>
  fetchImpl?: typeof fetch
}): Promise<ChatAttachmentMeta[]> {
  const files = input.claim.attachments ?? []
  if (!files.length) return []
  const directory = await fs.mkdtemp(path.join(input.workDir, 'visitor-files-'))
  const output: ChatAttachmentMeta[] = []
  let total = 0
  try {
  for (const [index, file] of files.entries()) {
    const signed = await input.delivery.attachment({ machineToken: input.machineToken,
      claim: input.claim, attachmentId: file.attachmentId })
    const size = Number(signed.byteSize)
    if (!Number.isSafeInteger(size) || size < 1 || size > MAX_TOTAL
      || size !== Number(file.byteSize) || signed.sha256 !== file.sha256
      || signed.name !== file.name || signed.mimeType !== file.mimeType) {
      throw new Error('public_agent_attachment_mismatch')
    }
    total += size
    if (total > MAX_TOTAL) throw new Error('public_agent_attachment_too_large')
    const response = await (input.fetchImpl ?? fetch)(signed.downloadUrl, {
      redirect: 'error', signal: AbortSignal.timeout(120_000),
    })
    if (!response.ok || Number(response.headers.get('content-length')) !== size) {
      throw new Error('public_agent_attachment_download_failed')
    }
    const reader = response.body?.getReader()
    if (!reader) throw new Error('public_agent_attachment_download_failed')
    const chunks: Buffer[] = []
    let received = 0
    for (;;) {
      const part = await reader.read()
      if (part.done) break
      received += part.value.byteLength
      if (received > size) {
        await reader.cancel()
        throw new Error('public_agent_attachment_too_large')
      }
      chunks.push(Buffer.from(part.value))
    }
    const bytes = Buffer.concat(chunks)
    if (bytes.byteLength !== size
      || crypto.createHash('sha256').update(bytes).digest('hex') !== signed.sha256) {
      throw new Error('public_agent_attachment_hash_mismatch')
    }
    const safeName = signed.name.replace(/[\\/\0-\x1f\x7f:]/g, '_').slice(0, 200)
    const filePath = path.join(directory, `${index + 1}-${safeName}`)
    await fs.writeFile(filePath, bytes, { flag: 'wx', mode: 0o600 })
    output.push({ path: filePath, name: signed.name, mimeType: signed.mimeType,
      kind: file.mediaKind === 'image' ? 'image' : 'file', byteSize: size,
      sha256: signed.sha256 })
  }
  return output
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true })
    throw error
  }
}
