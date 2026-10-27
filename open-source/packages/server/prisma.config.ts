import { config } from 'dotenv'
import { defineConfig, env } from 'prisma/config'
import { fileURLToPath } from 'node:url'
config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true })
config({ path: fileURLToPath(new URL('./.env', import.meta.url)), quiet: true })
export default defineConfig({
  schema: fileURLToPath(new URL('./prisma/schema.prisma', import.meta.url)),
  migrations: { path: fileURLToPath(new URL('../../deploy/self-hosted/prisma/migrations', import.meta.url)) },
  datasource: { url: env('DATABASE_URL') },
})
