import { sanitizePageMethods, type PageMethod } from './page-methods.js'
// @arch open-source/docs/server-runtime.md
// @test src/__tests__/interactive-web-observation.test.ts
import { ContentError } from './repository.js'
export type RuntimeObservation = { text: string; controls: Array<{ name: string; type: string; value: string }>; methods?: PageMethod[] }
export function sanitizeRuntimeObservation(value: unknown): RuntimeObservation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ContentError('invalid_observation')
  const input = value as Record<string, unknown>
  if (typeof input.text !== 'string' || input.text.length > 6000 || !Array.isArray(input.controls) || input.controls.length > 20) throw new ContentError('invalid_observation')
  const controls = input.controls.map((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new ContentError('invalid_observation')
    const control = item as Record<string, unknown>
    if (typeof control.name !== 'string' || typeof control.type !== 'string' || typeof control.value !== 'string'
      || control.name.length > 100 || control.type.length > 30 || control.value.length > 200) throw new ContentError('invalid_observation')
    if (['password', 'hidden', 'file'].includes(control.type)) throw new ContentError('sensitive_observation_field')
    return { name: control.name, type: control.type, value: control.value }
  })
  const methods = sanitizePageMethods(input.methods)
  return { text: input.text, controls, ...(methods.length ? { methods } : {}) }
}

/** Keep even quote-heavy DOM data below the Agent result budget; never silently drop later controls. */
export function observationChunk(value: RuntimeObservation, textOffset = 0, controlOffset = 0) {
  return { text: value.text.slice(textOffset, textOffset + 3000), controls: value.controls.slice(controlOffset, controlOffset + 10),
    nextTextOffset: textOffset + 3000 < value.text.length ? textOffset + 3000 : null,
    nextControlOffset: controlOffset + 10 < value.controls.length ? controlOffset + 10 : null }
}
