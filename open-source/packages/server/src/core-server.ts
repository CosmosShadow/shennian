// @arch open-source/docs/server-runtime.md
// @test open-source/deploy/self-hosted/core-boundary.test.mjs
import './env.js'
import { getDeploymentMode, validateSelfHostedEnvironment } from './services/instance-settings.js'
import { startServer } from './server-runtime.js'

// Explicit core entry: no official Import, no module search and no cloud fallback.
if (getDeploymentMode() !== 'self-hosted') throw new Error('core_entry_requires_self_hosted')
validateSelfHostedEnvironment()
await startServer()
