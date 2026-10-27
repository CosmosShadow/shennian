// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/session-manager-fs-read-text-encoding.test.ts

import { TextDecoder } from 'node:util'

const AUTO_TEXT_ENCODINGS = new Set(['auto', 'utf8-auto', 'utf-8-auto', 'text-auto'])
const TEXT_SAMPLE_BYTES = 8192
const MAX_SUSPICIOUS_CONTROL_RATIO = 0.01

export class BinaryTextPreviewError extends Error {
  constructor() {
    super('File appears to be binary; use encoding=base64')
    this.name = 'BinaryTextPreviewError'
  }
}

export type AutoTextDecodeResult = {
  content: string
  encoding: 'utf8' | 'utf16le' | 'utf16be' | 'gb18030' | 'windows-1252'
  fallback: boolean
}

export function isAutoTextEncoding(value: string): boolean {
  return AUTO_TEXT_ENCODINGS.has(value.trim().toLowerCase())
}

function startsWithBytes(buffer: Buffer, bytes: number[]): boolean {
  if (buffer.length < bytes.length) return false
  return bytes.every((byte, index) => buffer[index] === byte)
}

function isAllowedTextControlByte(byte: number): boolean {
  return byte === 0x09 || byte === 0x0a || byte === 0x0c || byte === 0x0d || byte === 0x1b
}

function hasBinaryMagic(buffer: Buffer): boolean {
  return (
    startsWithBytes(buffer, [0x25, 0x50, 0x44, 0x46]) || // PDF
    startsWithBytes(buffer, [0x50, 0x4b, 0x03, 0x04]) || // ZIP / Office Open XML
    startsWithBytes(buffer, [0x50, 0x4b, 0x05, 0x06]) ||
    startsWithBytes(buffer, [0x50, 0x4b, 0x07, 0x08]) ||
    startsWithBytes(buffer, [0x89, 0x50, 0x4e, 0x47]) || // PNG
    startsWithBytes(buffer, [0xff, 0xd8, 0xff]) || // JPEG
    startsWithBytes(buffer, [0x47, 0x49, 0x46, 0x38]) || // GIF
    startsWithBytes(buffer, [0x52, 0x49, 0x46, 0x46]) || // RIFF / WebP / WAV / AVI
    startsWithBytes(buffer, [0x1f, 0x8b]) || // gzip
    startsWithBytes(buffer, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]) || // 7z
    startsWithBytes(buffer, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07]) || // RAR
    startsWithBytes(buffer, [0x7f, 0x45, 0x4c, 0x46]) || // ELF
    startsWithBytes(buffer, [0xcf, 0xfa, 0xed, 0xfe]) || // Mach-O
    startsWithBytes(buffer, [0xca, 0xfe, 0xba, 0xbe]) ||
    startsWithBytes(buffer, [0x4d, 0x5a]) || // Windows PE
    startsWithBytes(buffer, [0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66])
  )
}

function looksLikeBinaryBuffer(buffer: Buffer): boolean {
  if (hasBinaryMagic(buffer)) return true

  const sample = buffer.subarray(0, Math.min(buffer.length, TEXT_SAMPLE_BYTES))
  if (sample.length === 0) return false

  let suspiciousControls = 0
  for (const byte of sample) {
    if (byte === 0x00) return true
    if (byte < 0x20 && !isAllowedTextControlByte(byte)) suspiciousControls += 1
  }

  return suspiciousControls / sample.length > MAX_SUSPICIOUS_CONTROL_RATIO
}

function isAllowedTextControlCode(codePoint: number): boolean {
  return codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0c || codePoint === 0x0d || codePoint === 0x1b
}

function hasDecodedControlNoise(content: string): boolean {
  if (!content) return false

  let suspiciousControls = 0
  let total = 0
  for (const char of content.slice(0, TEXT_SAMPLE_BYTES)) {
    const codePoint = char.codePointAt(0) ?? 0
    total += 1
    if (
      ((codePoint >= 0x00 && codePoint < 0x20) || (codePoint >= 0x7f && codePoint <= 0x9f)) &&
      !isAllowedTextControlCode(codePoint)
    ) {
      suspiciousControls += 1
    }
  }

  return total > 0 && suspiciousControls / total > MAX_SUSPICIOUS_CONTROL_RATIO
}

function decodeStrict(
  buffer: Buffer,
  decoderEncoding: string,
  encoding: AutoTextDecodeResult['encoding'],
  fallback: boolean,
): AutoTextDecodeResult {
  const content = new TextDecoder(decoderEncoding, { fatal: true }).decode(buffer)
  if (hasDecodedControlNoise(content)) throw new BinaryTextPreviewError()
  return { content, encoding, fallback }
}

export function decodeTextBufferAuto(buffer: Buffer): AutoTextDecodeResult {
  if (buffer.length === 0) return { content: '', encoding: 'utf8', fallback: false }

  if (startsWithBytes(buffer, [0xef, 0xbb, 0xbf])) {
    return decodeStrict(buffer, 'utf-8', 'utf8', false)
  }
  if (startsWithBytes(buffer, [0xff, 0xfe])) {
    return decodeStrict(buffer, 'utf-16le', 'utf16le', true)
  }
  if (startsWithBytes(buffer, [0xfe, 0xff])) {
    return decodeStrict(buffer, 'utf-16be', 'utf16be', true)
  }

  if (looksLikeBinaryBuffer(buffer)) throw new BinaryTextPreviewError()

  try {
    return decodeStrict(buffer, 'utf-8', 'utf8', false)
  } catch (error) {
    if (error instanceof BinaryTextPreviewError) throw error
  }

  try {
    return decodeStrict(buffer, 'gb18030', 'gb18030', true)
  } catch (error) {
    if (error instanceof BinaryTextPreviewError) throw error
  }

  return decodeStrict(buffer, 'windows-1252', 'windows-1252', true)
}
