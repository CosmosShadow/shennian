// @covers open-source/packages/server/src/services/interactive-web/page-methods.ts
import { describe, expect, it } from 'vitest'
import { sanitizePageMethods, validatePageInvocation } from '../services/interactive-web/page-methods.js'
const method = { name: 'play', description: 'Play locally', parameters: { type: 'object', properties: { speed: { type: 'number', minimum: 0.5, maximum: 2 } }, required: ['speed'], additionalProperties: false } }
describe('named local page method definitions', () => {
  it('keeps page method schemas separate from platform authority', () => {
    const result = sanitizePageMethods([{ ...method, actorId: 'owner', canRestore: true }])
    expect(result).toEqual([method])
    expect(validatePageInvocation(result[0]!, { speed: 1 })).toEqual({ speed: 1 })
    expect(() => validatePageInvocation(result[0]!, { speed: 3 })).toThrow('invalid_page_method_arguments')
    expect(() => validatePageInvocation(result[0]!, { speed: 1, actorId: 'owner' })).toThrow('invalid_page_method_arguments')
  })
  it('rejects JS strings, recursive/remote schema refs, duplicate names and unbounded catalogs', () => {
    for (const bad of [[{ ...method, name: 'eval(x)' }], [{ ...method, parameters: { type: 'object', $ref: 'https://attacker.test/schema' } }],
      [method, method], Array(7).fill(method), [{ ...method, parameters: undefined }]]) {
      expect(() => sanitizePageMethods(bad)).toThrow()
    }
  })
})
