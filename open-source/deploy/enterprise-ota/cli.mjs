// @arch open-source/docs/enterprise-ota.md
// @test open-source/deploy/enterprise-ota/ota.test.mjs
import fs from 'node:fs'
import { publish, promote } from './store.mjs'
const [command, ...args] = process.argv.slice(2)
try {
  const options = { root: process.env.OTA_STORE, origin: process.env.OTA_PUBLIC_ORIGIN,
    certificatePem: fs.readFileSync(process.env.OTA_CERTIFICATE) }
  if (!options.root) throw new Error('OTA_STORE required')
  if (command === 'publish') {
    const [exportDir, platform, runtime, extraFile] = args
    if (!extraFile) throw new Error('Explicit public extra JSON file required')
    const id = publish({ ...options, exportDir, platform, runtime,
      channel: process.env.OTA_CHANNEL || 'preview', keyid: process.env.OTA_KEY_ID || 'main',
      privateKey: fs.readFileSync(process.env.OTA_PRIVATE_KEY_FILE),
      extra: JSON.parse(fs.readFileSync(extraFile, 'utf8')) })
    console.log(JSON.stringify({ candidate: id, activated: false }))
  } else if (command === 'promote') {
    const [id, expected] = args
    if (!id || !expected) throw new Error('promote requires candidate ID and expected ID (or none)')
    promote({ ...options, id, expected: expected === 'none' ? null : expected })
    console.log(JSON.stringify({ activated: id }))
  } else throw new Error('Expected publish or promote')
} catch {
  console.error('Enterprise OTA command failed. Check arguments, baseline, certificate, and local configuration; no secrets logged.')
  process.exitCode = 1
}
