// @covers open-source/deploy/enterprise-ota/store.mjs
// @covers open-source/deploy/enterprise-ota/server.mjs
// @covers open-source/deploy/enterprise-ota/cli.mjs
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawnSync } from 'node:child_process'
import { publish, promote, certificate, verifyUpdate } from './store.mjs'
import { createHandler } from './server.mjs'
let tmp, root, exportDir, pem, privateKey, cert
const origin = 'https://ota.company.example'
before(() => {
  const parent = path.join(os.tmpdir(), 'shennian-tests/unit')
  fs.mkdirSync(parent, { recursive: true })
  tmp = fs.mkdtempSync(path.join(parent, 'enterprise-ota-'))
  root = path.join(tmp, 'data'); exportDir = path.join(tmp, 'export')
  fs.mkdirSync(exportDir); fs.mkdirSync(root)
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(tmp, 'key.pem'), '-out', path.join(tmp, 'cert.pem'), '-days', '1', '-subj', '/CN=Unit OTA', '-addext', 'extendedKeyUsage=codeSigning'], { stdio: 'ignore' })
  pem = fs.readFileSync(path.join(tmp, 'cert.pem')); privateKey = fs.readFileSync(path.join(tmp, 'key.pem')); cert = certificate(pem)
  fs.writeFileSync(path.join(exportDir, 'app.hbc'), 'unit bundle')
  fs.writeFileSync(path.join(exportDir, 'image.png'), 'unit asset')
  fs.writeFileSync(path.join(exportDir, 'metadata.json'), JSON.stringify({ fileMetadata: { ios: { bundle: 'app.hbc', assets: [{ path: 'image.png', ext: 'png' }] } } }))
})
after(() => fs.rmSync(tmp, { recursive: true, force: true }))
const candidate = () => publish({ root, exportDir, origin, runtime: 'company-1', platform: 'ios', privateKey, certificatePem: pem })
function request(headers = {}, url = '/api/updates', method = 'GET') {
  const response = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v }, end(body) { this.body = body } }
  createHandler({ root, certificatePem: pem, origin })({ url, method, headers: { 'expo-protocol-version': '1', 'expo-platform': 'ios', 'expo-runtime-version': 'company-1', 'expo-channel-name': 'preview', accept: 'application/expo+json', ...headers } }, response)
  return response
}
test('offline candidate does not activate; signature and asset hashes verify', () => {
  const id = candidate(); const update = verifyUpdate(root, id, cert, origin)
  assert.equal(update.manifest.runtimeVersion, 'company-1')
  assert.equal(fs.existsSync(path.join(root, 'channels')), false)
  assert.equal(request().statusCode, 406)
  assert.equal(request({ accept: 'multipart/mixed' }).statusCode, 204)
  promote({ root, id, origin, certificatePem: pem })
  const reply = request({ 'expo-expect-signature': 'sig, keyid="main"' })
  assert.equal(reply.statusCode, 200)
  assert.equal(reply.body, update.body)
  assert.equal(reply.headers['expo-signature'], update.signature)
  assert.equal(crypto.verify('RSA-SHA256', Buffer.from(reply.body), cert.publicKey, Buffer.from(/sig="([^"]+)"/.exec(reply.headers['expo-signature'])[1], 'base64')), true)
  const multipart = request({ accept: 'multipart/mixed' })
  assert.match(multipart.headers['Content-Type'], /multipart\/mixed/)
  assert.ok(multipart.body.includes(update.signature))
  const asset = update.manifest.launchAsset
  assert.equal(request({}, new URL(asset.url).pathname).body.toString(), 'unit bundle')
  assert.equal(request({ 'expo-runtime-version': 'other', accept: 'multipart/mixed' }).statusCode, 204)
  assert.equal(request({ 'expo-platform': 'android', accept: 'multipart/mixed' }).statusCode, 204)
  assert.equal(request({ 'expo-channel-name': 'production', accept: 'multipart/mixed' }).statusCode, 204)
  assert.equal(request({ 'expo-expect-signature': 'sig, keyid="other"' }).statusCode, 406)
})
test('HTTP rejects writes, invalid paths, protocol and unacceptable response types', () => {
  assert.equal(request({}, '/api/updates', 'POST').statusCode, 405)
  assert.equal(request({ 'expo-protocol-version': '0' }).statusCode, 406)
  assert.equal(request({ 'expo-runtime-version': '../../secret' }).statusCode, 400)
  assert.equal(request({ accept: 'text/html' }).statusCode, 406)
  assert.equal(request({ accept: 'application/json;q=0' }).statusCode, 406)
  assert.equal(request({}, '/key.pem').statusCode, 404)
})
test('promotion requires exact baseline and a newer timestamp', () => {
  const id = candidate()
  assert.throws(() => promote({ root, id, origin, certificatePem: pem }), /baseline/)
  assert.throws(() => promote({ root, id, origin, certificatePem: pem, expected: 'wrong' }), /baseline/)
  const current = JSON.parse(fs.readFileSync(path.join(root, 'channels/preview/company-1/ios.json'), 'utf8')).id
  assert.throws(() => promote({ root, id: current, origin, certificatePem: pem, expected: current }), /timestamp/)
})
test('rejects wrong signing keys, non-HTTPS origins and symlink source escapes', () => {
  const wrong = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' })
  const base = { root, exportDir, origin, runtime: 'company-1', platform: 'ios', privateKey, certificatePem: pem }
  assert.throws(() => publish({ ...base, privateKey: wrong }), /mismatch/)
  assert.throws(() => publish({ ...base, origin: 'http://ota.example' }), /HTTPS/)
  const bundle = path.join(exportDir, 'app.hbc')
  fs.renameSync(bundle, `${bundle}.saved`)
  fs.symlinkSync(path.join(tmp, 'key.pem'), bundle)
  try { assert.throws(() => publish(base), /escapes/) }
  finally { fs.rmSync(bundle); fs.renameSync(`${bundle}.saved`, bundle) }
})
test('tampering manifest or downloaded assets is detected', () => {
  const id = candidate(); const manifestFile = path.join(root, 'updates', id, 'manifest.json')
  const original = fs.readFileSync(manifestFile)
  const stored = JSON.parse(original); stored.body += ' '
  fs.writeFileSync(manifestFile, JSON.stringify(stored))
  assert.throws(() => verifyUpdate(root, id, cert, origin), /signature/)
  fs.writeFileSync(manifestFile, original)
  const update = verifyUpdate(root, id, cert, origin)
  const file = path.join(root, 'updates', id, 'assets', update.manifest.launchAsset.hash)
  fs.writeFileSync(file, 'tampered')
  assert.throws(() => verifyUpdate(root, id, cert, origin), /hash/)
  assert.equal(request({}, new URL(update.manifest.launchAsset.url).pathname).statusCode, 503)
})
test('CLI creates candidate and activates separately; errors never echo key material', () => {
  const cli = new URL('./cli.mjs', import.meta.url)
  const cliRoot = path.join(tmp, 'cli-data'); fs.mkdirSync(cliRoot)
  const extra = path.join(tmp, 'extra.json'); fs.writeFileSync(extra, '{}')
  const env = { ...process.env, OTA_STORE: cliRoot, OTA_PUBLIC_ORIGIN: origin, OTA_CERTIFICATE: path.join(tmp, 'cert.pem'), OTA_PRIVATE_KEY_FILE: path.join(tmp, 'key.pem') }
  const result = JSON.parse(execFileSync(process.execPath, [fileURLToPath(cli), 'publish', exportDir, 'ios', 'company-1', extra], { env }))
  assert.equal(result.activated, false)
  const active = JSON.parse(execFileSync(process.execPath, [fileURLToPath(cli), 'promote', result.candidate, 'none'], { env }))
  assert.equal(active.activated, result.candidate)
  const fail = spawnSync(process.execPath, [fileURLToPath(cli), 'promote', result.candidate, 'wrong'], { env, encoding: 'utf8' })
  assert.equal(fail.status, 1); assert.ok(!fail.stderr.includes('PRIVATE KEY'))
})

test('public build policy works independently with no official module or Expo dependency', async () => {
  const { default: policy } = await import('../../config/ota.cjs')
  assert.deepEqual(policy.selfHostedOtaConfig({}), { enabled: false })
  const env = { SHENNIAN_OTA_MODE: 'self-hosted', SHENNIAN_OTA_URL: `${origin}/api/updates`, SHENNIAN_OTA_CODE_SIGNING_CERTIFICATE: '/public/cert.pem' }
  const before = policy.selfHostedOtaConfig(env)
  assert.deepEqual(policy.selfHostedOtaConfig({ ...env, EXPO_PUBLIC_SHENNIAN_SERVER_URL: 'https://other.example' }), before)
  assert.throws(() => policy.selfHostedOtaConfig({ ...env, SHENNIAN_OTA_URL: 'http://unsafe.example' }), /HTTPS/)
})
