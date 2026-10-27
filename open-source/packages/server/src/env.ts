import { config as loadEnv } from 'dotenv'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const currentDir = dirname(fileURLToPath(import.meta.url))
const serverDir = resolve(currentDir, '..')
const repoRoot = resolve(serverDir, '..', '..')

loadEnv({ path: resolve(repoRoot, '.env'), quiet: true })
loadEnv({ path: resolve(serverDir, '.env'), quiet: true })
