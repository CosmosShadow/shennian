// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/personal-model-settings.test.ts
import { loadConfig } from '../config/index.js'
import { regionToUrl } from '../region.js'
export function personalModelServerUrl() { return (loadConfig().serverUrl ?? regionToUrl('cn')).replace(/\/$/, '') }
/** The paired Client already owns a long-lived per-machine key. No periodic issuance or extra key file. */
export class OfficialModelCredential {
  async get(): Promise<string> {
    const config = loadConfig()
    if (!config.machineToken || !config.machineId) throw new Error('personal_model_pairing_required')
    return config.machineToken
  }
}
