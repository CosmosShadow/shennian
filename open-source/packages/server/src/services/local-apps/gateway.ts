// @arch open-source/docs/server-runtime.md
// @test src/__tests__/local-apps.test.ts
import { randomBytes } from 'node:crypto'
import { LOCAL_APP_MAX_BYTES, personalServiceInput, type LocalApp, type PersonalServiceResponse, type ReqMethod } from '@shennian/wire'
import { prisma } from '../../lib/prisma.js'
import { redis } from '../../lib/redis.js'
import { sendServerReqToMachine } from '../../relay/server-requests.js'

export const RUNTIME_SECONDS = 3600
export type Runtime = { userId: string; deviceId: string; machineId: string; app: LocalApp; cookie: string }
export async function ownedMachine(userId: string, machineId: string) {
  if (!/^[\w-]{1,100}$/.test(machineId)) throw new Error('invalid_machine')
  const machine = await prisma.machine.findFirst({ where: { id: machineId, userId, paired: true, remoteAccessDisabledAt: null }, select: { id: true, name: true, online: true } })
  if (!machine) throw new Error('machine_owner_required')
  return machine
}
export async function machineCall(userId: string, machineId: string, method: ReqMethod, params: unknown) {
  const machine = await ownedMachine(userId, machineId)
  if (!machine.online) throw new Error('local_machine_unavailable')
  try {
    const res = await sendServerReqToMachine(machineId, { type: 'req', method, params: params as Record<string, unknown> }, 20000)
    if (!res.ok) throw new Error(/^(invalid_|local_app_|service_)/.test(res.error ?? '') ? res.error : 'local_client_upgrade_required')
    return res.payload
  } catch (error) {
    if (error instanceof Error && /^(invalid_|local_app_|service_|local_client_)/.test(error.message)) throw error
    throw new Error('local_machine_unavailable')
  }
}
export async function listApps(userId: string, machineId: string): Promise<LocalApp[]> {
  const payload = await machineCall(userId, machineId, 'personal.apps.list', {}) as { apps?: LocalApp[] }
  if (!Array.isArray(payload?.apps) || payload.apps.length > 100) throw new Error('local_client_upgrade_required')
  return payload.apps.map(app => {
    personalServiceInput({ appId: app.id, port: app.port, method: 'GET', path: app.entryPath })
    if (typeof app.title !== 'string' || app.title.length > 120 || typeof app.directory !== 'string' || app.directory.length > 1000) throw new Error('local_app_invalid')
    return app
  })
}
export async function relayService(userId: string, machineId: string, raw: unknown): Promise<PersonalServiceResponse> {
  const input = personalServiceInput(raw)
  const output = await machineCall(userId, machineId, 'personal.service', input) as PersonalServiceResponse
  if (!output || !Number.isInteger(output.status) || output.status < 200 || output.status > 599 || typeof output.base64 !== 'string' || output.base64.length > Math.ceil(LOCAL_APP_MAX_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(output.base64)) throw new Error('service_invalid_response')
  const headers: Record<string, string> = {}
  for (const name of ['content-type', 'etag', 'last-modified']) {
    const value = output.headers?.[name]
    if (typeof value === 'string' && value.length < 1000 && !/[\r\n]/.test(value)) headers[name] = value
  }
  return { status: output.status, headers, base64: output.base64 }
}
export async function createRuntime(userId: string, deviceId: string, machineId: string, appId: string) {
  const app = (await listApps(userId, machineId)).find(a => a.id === appId)
  if (!app) throw new Error('local_app_unavailable')
  const token = randomBytes(24).toString('hex'), cookie = randomBytes(24).toString('hex')
  await redis.set(`local-app-runtime:${token}`, JSON.stringify({ userId, deviceId, machineId, app, cookie } satisfies Runtime), 'EX', RUNTIME_SECONDS)
  return { token, app }
}
export async function readRuntime(token: string): Promise<Runtime> {
  if (!/^[a-f0-9]{48}$/.test(token)) throw new Error('local_runtime_expired')
  const raw = await redis.get(`local-app-runtime:${token}`)
  if (!raw) throw new Error('local_runtime_expired')
  return JSON.parse(raw) as Runtime
}
