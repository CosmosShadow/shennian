// @arch docs/features/network-rooms/mobile-control-and-single-room-web.md
// @test src/__tests__/first-machine-setup.test.ts

import { getServerUrl } from '../../config/server'

export const SHENNIAN_AGENT_INSTALL_DOC_URL = `${getServerUrl().replace(/\/+$/, '')}/install.md`
export const SHENNIAN_SKILL_URL = `${getServerUrl().replace(/\/+$/, '')}/skill.md`
export const SHENNIAN_MANUAL_INSTALL_URL = `${getServerUrl().replace(/\/+$/, '')}/docs#manual-install`
export const SHENNIAN_CLI_INSTALL_COMMAND = 'npm install -g shennian@latest\nshennian'
