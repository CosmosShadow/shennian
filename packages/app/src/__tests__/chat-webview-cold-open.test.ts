// @covers packages/app/src/components/chat/ChatWebView.native.tsx

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const __dirname = dirname(fileURLToPath(import.meta.url))

describe('native chat WebView cold-open bootstrap', () => {
  it('waits for the initial history snapshot and replaces an empty timeline in one frame', () => {
    const source = readFileSync(
      resolve(__dirname, '../components/chat/ChatWebView.native.tsx'),
      'utf8',
    )

    expect(source).toContain('if (isLoading && messages.length === 0) return')
    expect(source).toContain('if (prev.length === 0 && next.length > 0)')
    expect(source).toContain('initialScroll: getInitialScrollTarget()')
  })

  it('retries the presentation acknowledgement after the WebView initializes', () => {
    const source = readFileSync(
      resolve(__dirname, '../components/chat/ChatWebView.native.tsx'),
      'utf8',
    )

    expect(source).toContain('startPresentationAckRetry(presentationToken')
    expect(source).toContain('[isLoading, messages, post, presentationToken, ready]')
  })

  it('never serializes attachment payloads merely to detect a message change', () => {
    const source = readFileSync(
      resolve(__dirname, '../components/chat/ChatWebView.native.tsx'),
      'utf8',
    )

    expect(source).toContain('attachmentListsEqual(msg.attachments, old.attachments)')
    expect(source).not.toContain('JSON.stringify(msg.attachments')
    expect(source).not.toContain('JSON.stringify(old.attachments')
  })

  it('never bridges inline base64 image payloads into the native WebView', () => {
    const source = readFileSync(
      resolve(__dirname, '../components/chat/ChatWebView.native.tsx'),
      'utf8',
    )

    expect(source).toContain("/^(?:file|content|blob|https?):/i.test(value)")
    expect(source).toContain('msg.attachments?.map(attachmentToWeb)')
    expect(source).toContain(
      'previewUrl: isBridgeSafePreviewUrl(previewUrl) ? previewUrl : null',
    )
  })

  it('loads the chat document as a cache file so WKWebView can read cached thumbnails', () => {
    const source = readFileSync(
      resolve(__dirname, '../components/chat/ChatWebView.native.tsx'),
      'utf8',
    )

    expect(source).toContain("new Directory(Paths.cache, 'chat-webview-documents')")
    expect(source).toContain('documentFile.write(htmlDocument)')
    expect(source).toContain('setSource({ uri: documentFile.uri })')
    expect(source).toContain('allowingReadAccessToURL={Paths.cache.uri}')
  })
})
