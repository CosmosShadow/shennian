import process from 'node:process'
import console from 'node:console'
// @arch open-source/docs/server-runtime.md
// @test open-source/deploy/self-hosted/init-config.test.mjs
import fs from 'node:fs'
import path from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { fileURLToPath, pathToFileURL, URL } from 'node:url'

export function createConfiguration(directory, { publicUrl, registration = 'invite' }) {
  const url = new URL(publicUrl)
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw Error('https_origin_required')
  if (!['closed', 'invite', 'open'].includes(registration)) throw Error('invalid_registration_policy')
  // Refuse any existing directory: never overwrite identities, secrets or deployment state.
  if (fs.existsSync(directory)) throw Error('configuration_already_exists')
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  fs.chmodSync(directory, 0o700)
  const key = () => randomBytes(32).toString('hex')
  const dbPassword = key()
  const server = {
    NODE_ENV: 'production', SHENNIAN_DEPLOYMENT_MODE: 'self-hosted',
    SHENNIAN_RELEASE: JSON.parse(fs.readFileSync(new URL('../../packages/server/package.json', import.meta.url), 'utf8')).version,
    SHENNIAN_PUBLIC_URL: url.origin, SHENNIAN_INSTANCE_ID: randomUUID(),
    SHENNIAN_ACCOUNT_NAMESPACE_ID: key(), JWT_SECRET: key(),
    SHENNIAN_STORAGE_PROVIDER: 'local', SHENNIAN_STORAGE_DIR: '/data/objects',
    SHENNIAN_STORAGE_SIGNING_SECRET: key(), SHENNIAN_PUSH_MODE: 'off',
    SHENNIAN_REGISTRATION_POLICY: registration,
    ...(registration === 'invite' ? { SHENNIAN_REGISTRATION_INVITE: key() } : {}),
    DATABASE_URL: `mysql://shennian:${dbPassword}@db:3306/shennian`,
    REDIS_URL: 'redis://redis:6379', PORT: '3000', WORKER_HEALTH_PORT: '3001',
  }
  const database = { MARIADB_DATABASE: 'shennian', MARIADB_USER: 'shennian', MARIADB_PASSWORD: dbPassword, MARIADB_ROOT_PASSWORD: key() }
  for (const [name, values] of [['server.env', server], ['database.env', database]]) {
    fs.writeFileSync(path.join(directory, name), Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { mode: 0o600, flag: 'wx' })
  }
  return { files: 2, registration }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2)
    if (args.length < 1 || args.length > 2) throw Error('usage: init-config.mjs https://your-domain [closed|invite|open]')
    const result = createConfiguration(fileURLToPath(new URL('./.runtime', import.meta.url)), { publicUrl: args[0], registration: args[1] })
    console.log(`Created ${result.files} private configuration files; registration=${result.registration}. Keep .runtime private and backed up. No credentials printed.`)
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
