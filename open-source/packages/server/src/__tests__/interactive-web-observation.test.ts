// @covers open-source/packages/server/src/services/interactive-web/runtime-observation.ts
import { describe, expect, it } from 'vitest'
import { observationChunk, sanitizeRuntimeObservation } from '../services/interactive-web/runtime-observation.js'
describe('bounded runtime observation data', () => {
  it('projects only visible data, never treats page-supplied permissions as authority', () => {
    expect(sanitizeRuntimeObservation({ text: 'Page', controls: [{ name: 'choice', type: 'select-one', value: 'yes', actorId: 'owner' }], canActivate: true }))
      .toEqual({ text: 'Page', controls: [{ name: 'choice', type: 'select-one', value: 'yes' }] })
  })
  it('paginates quote-heavy observations below tool result limits without losing later controls', () => {
    const value = { text: '"'.repeat(6000), controls: Array.from({ length: 20 }, (_, index) => ({ name: String(index), type: 'text', value: '"'.repeat(200) })) }
    const first = observationChunk(value)
    expect(JSON.stringify(first).length).toBeLessThan(16000)
    expect(first.nextTextOffset).toBe(3000); expect(first.nextControlOffset).toBe(10)
    const second = observationChunk(value, 3000, 10)
    expect(first.text + second.text).toBe(value.text)
    expect([...first.controls, ...second.controls]).toEqual(value.controls)
    expect(second.nextControlOffset).toBeNull()
  })
  it('rejects sensitive fields, large bodies and too many controls', () => {
    for (const invalid of [{ text: 'x'.repeat(6001), controls: [] }, { text: '', controls: Array(21).fill({}) },
      ...['password', 'hidden', 'file'].map((type) => ({ text: '', controls: [{ name: 'secret', type, value: 'private' }] }))]) {
      expect(() => sanitizeRuntimeObservation(invalid)).toThrow()
    }
  })
})
