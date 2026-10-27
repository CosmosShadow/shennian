// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/local-apps.test.ts
import type { Command } from 'commander'
import { loadConfig } from '../config/index.js'
import { normalizeInstanceOrigin } from '@shennian/wire'
import { regionToUrl } from '../region.js'
import { localApps } from '../local-apps/service.js'
export function registerLocalAppsCommand(program: Command) {
  const apps = program.command('local-apps').description('Manage local applications and explicit anonymous shares')
  apps.command('list').action(async () => console.log(JSON.stringify({ apps: await localApps.list() })))
  apps.command('inspect <id>').description('Read application configuration for an explicit AI question; no network request').action(async id => console.log(JSON.stringify({ app: await localApps.get(id), machineId: loadConfig().machineId ?? null })))
  apps.command('doctor <id>').description('Read-only registered entry GET check; no repairs or page content in output').action(async id => console.log(JSON.stringify(await localApps.doctor(id))))
  apps.command('register').requiredOption('--title <title>').requiredOption('--port <port>').option('--path <path>', 'Relative entry path', '/').option('--directory <directory>', 'Application source directory', process.cwd()).option('--id <id>', 'Update an existing app').action(async options => {
    console.log(JSON.stringify({ app: await localApps.register({ title: options.title, port: Number(options.port), entryPath: options.path, directory: options.directory, ...(options.id ? { id: options.id } : {}) }) }))
  })
  apps.command('share <id>').description('Publish a 30-day anonymous link; grant only explicitly listed assets and POST APIs').option('--asset <paths...>', 'Exact additional public GET asset paths', []).option('--post <paths...>', 'Exact public POST API paths; never include admin APIs', []).action(async (id, options) => {
    const app = await localApps.get(id)
    const result = await sharingRequest('POST', '/shares', { appId: app.id, assets: options.asset, posts: options.post }) as { shareId: string; sharePath: string; expiresIn: number }
    console.log(JSON.stringify({ ...result, url: sharingBase() + result.sharePath }))
  })
  apps.command('unshare <shareId>').description('Revoke a public link and all its visitor sessions').action(async shareId => console.log(JSON.stringify(await sharingRequest('DELETE', '/shares/' + encodeURIComponent(shareId)))))
  apps.command('remove <id>').description('Remove registry entry only; keep application files and data').action(async id => console.log(JSON.stringify(await localApps.remove(id))))
}

function sharingBase() { return normalizeInstanceOrigin(loadConfig().serverUrl ?? regionToUrl('cn')) }
async function sharingRequest(method: string, path: string, body?: Record<string, unknown>) {
  const config = loadConfig()
  if (!config.machineId || !config.machineToken) throw new Error('machine_pairing_required')
  const response = await fetch(sharingBase() + '/api/local-apps' + path, { method, headers: { authorization: `Bearer ${config.machineToken}`, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify({ ...body, machineId: config.machineId }) } : {}), signal: AbortSignal.timeout(25000) })
  if (!response.ok) throw new Error(`local_share_request_failed (${response.status})`)
  return response.json()
}
