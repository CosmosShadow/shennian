// @arch open-source/docs/enterprise-ota.md
// @test open-source/deploy/enterprise-ota/ota.test.mjs
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

export function token(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-][A-Za-z0-9._+-]{0,79}$/.test(value)) throw new Error('Invalid OTA identifier')
  return value
}
export function publicOrigin(value) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('OTA public origin must be HTTPS without path or credentials')
  return url.origin
}
export function containedFile(root, relative) {
  const base = fs.realpathSync(root)
  const file = fs.realpathSync(path.resolve(base, relative))
  if (!file.startsWith(base + path.sep) || !fs.statSync(file).isFile()) throw new Error('OTA file escapes root')
  return file
}
export function certificate(pem) {
  const cert = new crypto.X509Certificate(pem)
  if (cert.publicKey.asymmetricKeyType !== 'rsa' || (cert.publicKey.asymmetricKeyDetails?.modulusLength || 0) < 2048
    || !cert.keyUsage?.includes('1.3.6.1.5.5.7.3.3')
    || Date.now() < Date.parse(cert.validFrom) || Date.now() > Date.parse(cert.validTo)) throw new Error('Invalid OTA code-signing certificate')
  return cert
}
const hash = data => crypto.createHash('sha256').update(data).digest('base64url')
export function verifyUpdate(root, id, cert, origin) {
  token(id)
  const dir = `updates/${id}`
  const stored = JSON.parse(fs.readFileSync(containedFile(root, `${dir}/manifest.json`), 'utf8'))
  const match = /^sig="([A-Za-z0-9+/]+=*)", keyid="([A-Za-z0-9_-]+)"$/.exec(stored.signature || '')
  if (!match || !crypto.verify('RSA-SHA256', Buffer.from(stored.body), cert.publicKey, Buffer.from(match[1], 'base64'))) throw new Error('Invalid OTA signature')
  const manifest = JSON.parse(stored.body)
  if (manifest.id !== id || !Number.isFinite(Date.parse(manifest.createdAt))) throw new Error('Invalid OTA manifest')
  token(manifest.runtimeVersion)
  token(manifest.metadata.channel)
  if (!['ios', 'android'].includes(manifest.metadata.platform)) throw new Error('Invalid OTA platform')
  if (!Array.isArray(manifest.assets)) throw new Error('Invalid OTA assets')
  for (const asset of [manifest.launchAsset, ...manifest.assets]) {
    const url = new URL(asset.url)
    if (url.origin !== publicOrigin(origin) || url.search || url.hash || url.pathname !== `/assets/${id}/${asset.hash}`) throw new Error('Invalid OTA asset URL')
    if (!/^[A-Za-z0-9_-]{43}$/.test(asset.hash) || hash(fs.readFileSync(containedFile(root, `${dir}/assets/${asset.hash}`))) !== asset.hash) throw new Error('Invalid OTA asset hash')
  }
  return { ...stored, manifest }
}

/** Offline only: create immutable signed candidate; never activates a channel. */
export function publish({ root, exportDir, origin, runtime, platform, channel = 'preview', keyid = 'main', privateKey, certificatePem, extra = {} }) {
  origin = publicOrigin(origin)
  for (const value of [runtime, channel, keyid]) token(value)
  if (!/^[A-Za-z0-9_-]+$/.test(keyid)) throw new Error('Invalid keyid')
  if (!['ios', 'android'].includes(platform)) throw new Error('Invalid platform')
  const cert = certificate(certificatePem)
  const key = crypto.createPrivateKey(privateKey)
  if (!crypto.createPublicKey(key).export({ type: 'spki', format: 'der' }).equals(cert.publicKey.export({ type: 'spki', format: 'der' }))) throw new Error('Signing key mismatch')
  const meta = JSON.parse(fs.readFileSync(containedFile(exportDir, 'metadata.json'), 'utf8')).fileMetadata?.[platform]
  if (!meta?.bundle || !Array.isArray(meta.assets)) throw new Error('Missing Expo export metadata')
  const id = crypto.randomUUID()
  fs.mkdirSync(path.join(root, 'updates'), { recursive: true })
  const stage = fs.mkdtempSync(path.join(root, 'updates', '.candidate-'))
  try {
    fs.mkdirSync(path.join(stage, 'assets'))
    const asset = (relative, extension, launch = false) => {
      const data = fs.readFileSync(containedFile(exportDir, relative))
      const digest = hash(data)
      fs.writeFileSync(path.join(stage, 'assets', digest), data)
      return { hash: digest, key: digest, fileExtension: `.${extension}`, contentType: launch ? 'application/javascript' : 'application/octet-stream', url: `${origin}/assets/${id}/${digest}` }
    }
    const manifest = { id, createdAt: new Date().toISOString(), runtimeVersion: runtime,
      launchAsset: asset(meta.bundle, token(path.extname(meta.bundle).slice(1) || 'bundle'), true),
      assets: meta.assets.map(item => asset(item.path, token(item.ext))),
      metadata: { channel, platform }, extra }
    const body = JSON.stringify(manifest)
    const signature = `sig="${crypto.sign('RSA-SHA256', Buffer.from(body), key).toString('base64')}", keyid="${keyid}"`
    fs.writeFileSync(path.join(stage, 'manifest.json'), JSON.stringify({ body, signature }))
    fs.renameSync(stage, path.join(root, 'updates', id))
    verifyUpdate(root, id, cert, origin)
    return id
  } finally { fs.rmSync(stage, { recursive: true, force: true }) }
}

/** Operator-controlled atomic activation, with compare-and-swap and monotonic time. */
export function promote({ root, id, certificatePem, origin, expected = null }) {
  const cert = certificate(certificatePem)
  const { manifest } = verifyUpdate(root, id, cert, origin)
  const { channel, platform } = manifest.metadata
  const dir = path.join(root, 'channels', token(channel), token(manifest.runtimeVersion))
  fs.mkdirSync(dir, { recursive: true })
  const target = path.join(dir, `${platform}.json`)
  const lock = `${target}.lock`
  const fd = fs.openSync(lock, 'wx')
  const temp = `${target}.${crypto.randomUUID()}.tmp`
  try {
    const previous = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')).id : null
    if (previous !== expected) throw new Error('OTA baseline changed')
    if (previous && Date.parse(verifyUpdate(root, previous, cert, origin).manifest.createdAt) >= Date.parse(manifest.createdAt)) throw new Error('OTA timestamp must increase; republish rollback code as a new candidate')
    fs.writeFileSync(temp, JSON.stringify({ id }))
    fs.renameSync(temp, target)
  } finally { fs.closeSync(fd); fs.rmSync(lock, { force: true }); fs.rmSync(temp, { force: true }) }
}
