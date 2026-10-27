// @arch open-source/docs/enterprise-ota.md
// @test open-source/deploy/enterprise-ota/ota.test.mjs
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { certificate, containedFile, publicOrigin, token, verifyUpdate } from './store.mjs'

/** Read-only data plane: no upload, signing key, business login, or admin API. */
export function createHandler({ root, certificatePem, origin }) {
  const cert = certificate(certificatePem)
  origin = publicOrigin(origin)
  return (req, res) => {
    const finish = (status, body = '') => { res.statusCode = status; res.end(body) }
    if (req.method !== 'GET') return finish(405)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    try {
      const url = new URL(req.url, 'http://ota.invalid')
      if (url.pathname === '/healthz') return finish(200, 'ok')
      const asset = /^\/assets\/([a-f0-9-]{36})\/([A-Za-z0-9_-]{43})$/.exec(url.pathname)
      if (asset) {
        const data = fs.readFileSync(containedFile(root, `updates/${asset[1]}/assets/${asset[2]}`))
        if (crypto.createHash('sha256').update(data).digest('base64url') !== asset[2]) return finish(503)
        res.setHeader('Content-Type', 'application/octet-stream')
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        return finish(200, data)
      }
      if (url.pathname !== '/api/updates') return finish(404)
      res.setHeader('expo-protocol-version', '1')
      res.setHeader('expo-sfv-version', '0')
      res.setHeader('expo-manifest-filters', '')
      res.setHeader('expo-server-defined-headers', '')
      res.setHeader('Cache-Control', 'private, max-age=0')
      if (req.headers['expo-protocol-version'] !== '1') return finish(406)
      const platform = req.headers['expo-platform']
      if (!['ios', 'android'].includes(platform)) return finish(400)
      const runtime = token(req.headers['expo-runtime-version'])
      const channel = token(req.headers['expo-channel-name'] || 'production')
      res.setHeader('expo-manifest-filters', `channel="${channel}"`)
      const accept = req.headers.accept || ''
      // A single manifest or multipart response is supported; no rollback directive.
      const types = accept.split(',').map(part => part.trim().split(';'))
        .filter(parts => !parts.some(p => /^\s*q=0(?:\.0*)?\s*$/.test(p))).map(parts => parts[0])
      const multipart = types.includes('multipart/mixed')
      if (!multipart && !types.some(t => ['application/expo+json', 'application/json', '*/*'].includes(t))) return finish(406)
      const pointer = path.join(root, 'channels', channel, runtime, `${platform}.json`)
      if (!fs.existsSync(pointer)) return finish(multipart ? 204 : 406)
      const { id } = JSON.parse(fs.readFileSync(containedFile(root, path.relative(root, pointer)), 'utf8'))
      const update = verifyUpdate(root, id, cert, origin)
      if (update.manifest.runtimeVersion !== runtime || update.manifest.metadata.channel !== channel || update.manifest.metadata.platform !== platform) return finish(503)
      const expected = req.headers['expo-expect-signature'] || ''
      const keyid = /keyid="([^"]+)"/.exec(expected)?.[1]
      if (keyid && !update.signature.endsWith(`keyid="${keyid}"`)) return finish(406)
      if (multipart) {
        const boundary = `ota-${crypto.randomUUID()}`
        res.setHeader('Content-Type', `multipart/mixed; boundary="${boundary}"`)
        return finish(200, `--${boundary}\r\nContent-Disposition: form-data; name="manifest"\r\nContent-Type: application/json\r\nexpo-signature: ${update.signature}\r\n\r\n${update.body}\r\n--${boundary}--\r\n`)
      }
      res.setHeader('Content-Type', 'application/expo+json')
      res.setHeader('expo-signature', update.signature)
      return finish(200, update.body)
    } catch (error) {
      // Never send filesystem paths, configuration, or key material to callers.
      return finish(error?.code === 'ENOENT' ? 404 : 400)
    }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const handler = createHandler({ root: process.env.OTA_STORE || '/data', origin: process.env.OTA_PUBLIC_ORIGIN,
    certificatePem: fs.readFileSync(process.env.OTA_CERTIFICATE || '/config/certificate.pem') })
  http.createServer(handler).listen(8080, '0.0.0.0')
}
