// @arch open-source/docs/server-runtime.md
// @test src/__tests__/interactive-web-page-methods.test.ts
import Ajv from 'ajv'
import { ContentError } from './repository.js'
export type PageMethod = { name: string; description: string; parameters: Record<string, unknown> }
const allowed = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'minLength', 'maxLength', 'minimum', 'maximum', 'maxItems', 'description'])
function inspectSchema(value: unknown, depth = 0): void {
  if (depth > 6 || !value || typeof value !== 'object' || Array.isArray(value)) throw new ContentError('invalid_page_method_schema')
  for (const [key, item] of Object.entries(value)) {
    if (!allowed.has(key)) throw new ContentError('invalid_page_method_schema')
    if (key === 'properties') {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new ContentError('invalid_page_method_schema')
      for (const child of Object.values(item)) inspectSchema(child, depth + 1)
    } else if (key === 'items') inspectSchema(item, depth + 1)
  }
}
export function sanitizePageMethods(value: unknown): PageMethod[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 6 || JSON.stringify(value).length > 8000) throw new ContentError('invalid_page_methods')
  const names = new Set<string>()
  return value.map((item: unknown) => {
    const method = item as Partial<PageMethod> | null
    if (!method || typeof method.name !== 'string' || !/^[a-z][a-z0-9_.-]{0,63}$/i.test(method.name)
      || names.has(method.name) || typeof method.description !== 'string' || method.description.length > 200
      || !method.parameters || typeof method.parameters !== 'object' || JSON.stringify(method.parameters).length > 1000) throw new ContentError('invalid_page_method')
    inspectSchema(method.parameters)
    if (method.parameters?.type !== 'object') throw new ContentError('invalid_page_method_schema')
    new Ajv({ strict: true }).compile(method.parameters)
    names.add(method.name)
    return { name: method.name, description: method.description, parameters: method.parameters }
  })
}
export function validatePageInvocation(method: PageMethod, args: unknown) {
  if (!args || typeof args !== 'object' || Array.isArray(args) || JSON.stringify(args).length > 4000
    || !new Ajv({ strict: true }).compile(method.parameters)(args)) throw new ContentError('invalid_page_method_arguments')
  return args as Record<string, unknown>
}
