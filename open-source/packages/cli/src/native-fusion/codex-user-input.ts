// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/native-fusion-codex-delegation.test.ts
// @test src/__tests__/native-fusion-codex-current-input.test.ts

import { normalizeText } from './parser-common.js'

export function parseCodexTextElements(value: unknown): string {
  if (!Array.isArray(value)) return ''
  return value
    .map((item) => {
      if (typeof item === 'string') return item
      if (typeof item !== 'object' || item === null) return ''
      const record = item as Record<string, unknown>
      return typeof record.text === 'string' ? record.text : ''
    })
    .map((text) => normalizeText(text))
    .filter(Boolean)
    .join('\n\n')
}

function stripCodexImagePlaceholders(text: string): string {
  return normalizeText(text.replace(/<image>\s*<\/image>/gi, ''))
}

const CODEX_AMBIENT_BROWSER_REQUEST_RE =
  /^<in-app-browser-context\b(?=[^>]*\bsource=["']ambient-ui-state["'])[^>]*>[\s\S]*?<\/in-app-browser-context>\s*\n+##\s+My request(?: for Codex)?:\s*([\s\S]*)$/i

export function stripCodexUserMessageWrapper(text: string): {
  text: string
  strippedWrapper: boolean
} {
  const normalized = normalizeText(text)
  if (!normalized) return { text: '', strippedWrapper: false }
  const ambientBrowserRequestMatch = normalized.match(CODEX_AMBIENT_BROWSER_REQUEST_RE)
  if (ambientBrowserRequestMatch?.[1]) {
    return {
      text: stripCodexImagePlaceholders(ambientBrowserRequestMatch[1]),
      strippedWrapper: true,
    }
  }
  const requestMatch = normalized.match(/My request for Codex:\s*([\s\S]*)$/i)
  if (requestMatch?.[1]) {
    return { text: stripCodexImagePlaceholders(requestMatch[1]), strippedWrapper: true }
  }
  const attachmentRequestMatch = normalized.match(
    /^# Files mentioned by the user:\s*[\s\S]*?\n+## My request:\s*([\s\S]*)$/i,
  )
  if (attachmentRequestMatch?.[1]) {
    return { text: stripCodexImagePlaceholders(attachmentRequestMatch[1]), strippedWrapper: true }
  }
  return { text: normalized, strippedWrapper: false }
}

const CODEX_IMAGE_OPEN_TAG_RE = /^<image\b[^>]*\bpath="([^"]+)"[^>]*>\s*$/i
const CODEX_IMAGE_CLOSE_TAG_RE = /^<\/image>\s*$/i

export function parseCodexResponseUserInput(content: unknown): {
  text: string
  imagePaths: string[]
  strippedWrapper: boolean
} {
  if (!Array.isArray(content)) return { text: '', imagePaths: [], strippedWrapper: false }
  const ignoredTextIndexes = new Set<number>()
  const imagePaths: string[] = []

  for (let index = 0; index + 2 < content.length; index += 1) {
    const opening = content[index]
    const image = content[index + 1]
    const closing = content[index + 2]
    if (
      typeof opening !== 'object' || opening === null ||
      typeof image !== 'object' || image === null ||
      typeof closing !== 'object' || closing === null
    ) continue
    const openingRecord = opening as Record<string, unknown>
    const imageRecord = image as Record<string, unknown>
    const closingRecord = closing as Record<string, unknown>
    if (
      openingRecord.type !== 'input_text' || typeof openingRecord.text !== 'string' ||
      imageRecord.type !== 'input_image' ||
      closingRecord.type !== 'input_text' || typeof closingRecord.text !== 'string' ||
      !CODEX_IMAGE_CLOSE_TAG_RE.test(normalizeText(closingRecord.text))
    ) continue
    const imagePath = normalizeText(openingRecord.text).match(CODEX_IMAGE_OPEN_TAG_RE)?.[1]
    if (!imagePath) continue
    imagePaths.push(imagePath)
    ignoredTextIndexes.add(index)
    ignoredTextIndexes.add(index + 2)
  }

  const rawText = content
    .map((part, index) => {
      if (ignoredTextIndexes.has(index)) return ''
      if (typeof part === 'string') return part
      if (typeof part !== 'object' || part === null) return ''
      const record = part as Record<string, unknown>
      return record.type === 'input_text' && typeof record.text === 'string' ? record.text : ''
    })
    .map((text) => normalizeText(text))
    .filter(Boolean)
    .join('\n\n')
  const stripped = stripCodexUserMessageWrapper(rawText)
  return { ...stripped, imagePaths }
}

export function parseCodexDelegationInput(payload: Record<string, unknown>): string | null {
  if (payload.namespace !== 'codex_app' || typeof payload.output !== 'string') return null
  const normalized = normalizeText(payload.output)
  if (!normalized.startsWith('<codex_delegation>') || !normalized.endsWith('</codex_delegation>')) {
    return null
  }
  const input = normalized.match(/<input>([\s\S]*?)<\/input>\s*<\/codex_delegation>$/)?.[1]
  return input ? normalizeText(input) : null
}
