// @arch open-source/docs/cli-runtime.md
// @test src/__tests__/remote-access-pause.test.ts

import type { ReqFrame } from '@shennian/wire'
import type { CliRelayClient } from '../../relay/client.js'
import type { RemoteAccessPauseController } from '../types.js'

export async function handleRemoteAccessPause(
  client: CliRelayClient,
  controller: RemoteAccessPauseController | null,
  req: ReqFrame,
): Promise<void> {
  if (!controller) {
    await client.sendResAndWait({
      type: 'res',
      id: req.id,
      ok: false,
      error: 'upgrade_required',
    }).catch(() => {})
    return
  }

  try {
    const preparation = controller.prepare()
    if (!preparation.autoStartDisabled) {
      throw new Error(
        preparation.autoStartError
          ? `remote_access_autostart_disable_failed: ${preparation.autoStartError}`
          : 'remote_access_autostart_disable_failed',
      )
    }
    const acknowledgement = await client.sendBufferedEvent({
      type: 'event',
      id: `remote-access-paused-${req.id}`,
      event: 'machine.remote-access.paused',
      payload: { disabledAt: preparation.disabledAt },
    }, 30_000)
    const payload = acknowledgement && typeof acknowledgement.payload === 'object'
      ? acknowledgement.payload
      : { remoteAccessDisabledAt: preparation.disabledAt }
    await client.sendResAndWait({ type: 'res', id: req.id, ok: true, payload })
  } catch (error) {
    await client.sendResAndWait({
      type: 'res',
      id: req.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }).catch(() => {})
  } finally {
    if (controller.isDisabled()) controller.shutdownAfterResponse()
  }
}
