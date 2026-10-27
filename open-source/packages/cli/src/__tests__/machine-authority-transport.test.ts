// @covers src/personal-sync/machine-authority.ts
import http from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchMachineAuthorityResponse } from '../personal-sync/machine-authority.js'

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })
const reset = () => new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } })

describe('startup authority transport', () => {
  it('recovers from an actual TCP reset without changing the request', async () => {
    let requests = 0
    const server = http.createServer((req, res) => {
      requests += 1
      if (requests === 1) { req.socket.destroy(); return }
      res.end('transport reached')
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address() as { port: number }
      const url = `http://127.0.0.1:${address.port}/probe`
      // Reproduce the previous one-shot startup failure with real sockets.
      await expect(fetch(url)).rejects.toThrow('fetch failed')
      requests = 0
      const response = await fetchMachineAuthorityResponse(url, 'test')
      expect(await response.text()).toBe('transport reached')
      expect(requests).toBe(2)
    } finally {
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })

  it('stops after three transport failures and reuses the deadline signal', async () => {
    vi.useFakeTimers()
    const request = vi.fn<typeof fetch>().mockRejectedValue(reset())
    const assertion = expect(fetchMachineAuthorityResponse('https://example.test', 'test', request))
      .rejects.toThrow('fetch failed')
    await vi.runAllTimersAsync()
    await assertion
    expect(request).toHaveBeenCalledTimes(3)
    expect(new Set(request.mock.calls.map(call => call[1]?.signal)).size).toBe(1)
  })

  it.each([401, 403, 404, 500])('does not retry HTTP %s responses', async status => {
    const response = new Response('', { status })
    const request = vi.fn<typeof fetch>().mockResolvedValue(response)
    expect(await fetchMachineAuthorityResponse('https://example.test', 'test', request)).toBe(response)
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('does not retry after the shared ten-second deadline expires', async () => {
    const controller = new AbortController()
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal)
    const request = vi.fn<typeof fetch>().mockImplementation(async () => {
      controller.abort()
      throw reset()
    })
    await expect(fetchMachineAuthorityResponse('https://example.test', 'test', request))
      .rejects.toThrow('fetch failed')
    expect(request).toHaveBeenCalledTimes(1)
    expect(timeout).toHaveBeenCalledExactlyOnceWith(10_000)
  })

  it('does not retry an unclassified error', async () => {
    const request = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('invalid URL'))
    await expect(fetchMachineAuthorityResponse('invalid', 'test', request)).rejects.toThrow('invalid URL')
    expect(request).toHaveBeenCalledTimes(1)
  })
})
