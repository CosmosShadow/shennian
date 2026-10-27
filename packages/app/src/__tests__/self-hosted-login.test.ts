// @arch docs/features/self-hosted-instances.md
// @covers packages/app/src/config/server.ts
// @covers packages/app/src/features/auth/components/SelfHostedLoginPanel.tsx
import { afterEach, describe, expect, it, vi } from 'vitest'
afterEach(() => { vi.resetModules(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })
async function setup() {
  const data = new Map<string, string>()
  vi.doMock('react-native', () => ({ Platform: { OS: 'ios' } }))
  vi.doMock('@react-native-async-storage/async-storage', () => ({ default: {
    getItem: async (key: string) => data.get(key) ?? null,
    setItem: async (key: string, value: string) => { data.set(key, value) },
  } }))
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ schemaVersion: 1, mode: 'self-hosted', instanceId: 'test-selfhost-1234567890', auth: { password: true } }) })))
  const server = await import('../config/server')
  await server.loadServerConfig()
  return { server, data }
}
describe('single self-hosted login selection', () => {
  it('discovers an HTTPS IP and never sends credentials in discovery', async () => {
    const { server } = await setup()
    await server.selectLoginServer('192.168.1.10:8443')
    expect(server.getServerUrl()).toBe('https://192.168.1.10:8443')
    expect(server.getAuthStorageKey('shennian_auth')).not.toBe('shennian_auth')
    expect(fetch).toHaveBeenCalledWith('https://192.168.1.10:8443/public/instance', expect.objectContaining({ credentials: 'omit', redirect: 'error' }))
    await server.ensureDetected()
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('refuses cross-instance rebinding and changes during an active login', async () => {
    const { server } = await setup()
    const release = server.beginLoginServerUse()
    await expect(server.selectLoginServer('company.test')).rejects.toThrow('instance_login_in_progress')
    release()
    await server.selectLoginServer('company.test')
    await server.lockServerBinding()
    await expect(server.selectLoginServer(null)).rejects.toThrow('instance_already_bound')
    await expect(server.selectLoginServer('other.test')).rejects.toThrow('instance_already_bound')
  })
  it('rejects plaintext private IPs and malformed discovery without changing origin', async () => {
    const { server } = await setup()
    await expect(server.selectLoginServer('http://192.168.1.10')).rejects.toThrow('instance_requires_https')
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ mode: 'official' }) } as Response)
    await expect(server.selectLoginServer('company.test')).rejects.toThrow('invalid_instance')
    expect(server.isSelfHostedSelection()).toBe(false)
  })
})
