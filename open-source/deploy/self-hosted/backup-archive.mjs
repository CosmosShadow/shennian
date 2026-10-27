import { Buffer } from 'node:buffer'
import process from 'node:process'
import console from 'node:console'
// @arch open-source/docs/system-architecture.md
// @test open-source/deploy/self-hosted/backup-archive.test.mjs
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import { pathToFileURL } from 'node:url'

const MAGIC = Buffer.from('SHNBACK1')
function regular(file) {
  const stat = fs.lstatSync(file)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('regular_file_required')
  return stat
}
function readKey(file) {
  const stat = regular(file)
  if ((stat.mode & 0o077) !== 0) throw new Error('key_permissions_must_be_private')
  const key = fs.readFileSync(file)
  if (key.length !== 32) throw new Error('key_must_be_32_random_bytes')
  return key
}

/** Authenticated encryption only; deliberately does NOT extract or start restored services. */
export async function archive({ mode, input, output, keyFile }) {
  if (!['seal', 'open'].includes(mode)) throw new Error('invalid_archive_mode')
  const stat = regular(input)
  if (fs.existsSync(output)) throw new Error('output_must_not_exist')
  if (path.resolve(input) === path.resolve(output) || path.resolve(keyFile) === path.resolve(output)) {
    throw new Error('distinct_paths_required')
  }
  const key = readKey(keyFile)
  const temporary = `${output}.partial-${crypto.randomUUID()}`
  try {
    if (mode === 'seal') {
      const nonce = crypto.randomBytes(12)
      const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce)
      cipher.setAAD(MAGIC)
      fs.writeFileSync(temporary, Buffer.concat([MAGIC, nonce]), { flag: 'wx', mode: 0o600 })
      await pipeline(fs.createReadStream(input), cipher, fs.createWriteStream(temporary, { flags: 'a', mode: 0o600 }))
      fs.appendFileSync(temporary, cipher.getAuthTag())
    } else {
      if (stat.size < 36) throw new Error('invalid_archive_header')
      const fd = fs.openSync(input, 'r')
      const header = Buffer.alloc(20), tag = Buffer.alloc(16)
      try {
        fs.readSync(fd, header, 0, 20, 0)
        fs.readSync(fd, tag, 0, 16, stat.size - 16)
      } finally { fs.closeSync(fd) }
      if (!header.subarray(0, 8).equals(MAGIC)) throw new Error('invalid_archive_header')
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, header.subarray(8))
      decipher.setAAD(MAGIC)
      decipher.setAuthTag(tag)
      const source = stat.size === 36
        ? (await import('node:stream')).Readable.from([])
        : fs.createReadStream(input, { start: 20, end: stat.size - 17 })
      await pipeline(source, decipher, fs.createWriteStream(temporary, { flags: 'wx', mode: 0o600 }))
    }
    // link is atomic and refuses to overwrite a concurrently created destination.
    fs.linkSync(temporary, output)
    return { mode, bytes: fs.statSync(output).size }
  } finally {
    key.fill(0)
    fs.rmSync(temporary, { force: true })
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [mode, input, output, keyFile] = process.argv.slice(2)
  if (!mode || !input || !output || !keyFile || process.argv.length !== 6) {
    console.error('usage: node backup-archive.mjs seal|open INPUT OUTPUT KEY_FILE'); process.exitCode = 1
  } else {
    try { console.log(JSON.stringify(await archive({ mode, input, output, keyFile }))) }
    catch { console.error('backup_archive_failed; output not published; inspect protected local inputs'); process.exitCode = 1 }
  }
}
