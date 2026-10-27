// @arch docs/features/desktop-local-first-client.md#33-进程职责
// @test ../../__tests__/machine-sharing-source.test.ts
import { Redirect } from 'expo-router'
import { useAuthStore } from '../../config/auth'
import { isDesktopControlSurfaceEnabled } from '../../utils/controlSurfaceLayout'
import MachineInviteAcceptanceScreen from './MachineInviteAcceptanceScreen'
import MachineInviteWebScreen from './MachineInviteWebScreen'

export default function DesktopMachineInviteScreen({ token }: { token: string }) {
  const authenticated = useAuthStore((state) => state.isAuthenticated)
  if (!isDesktopControlSurfaceEnabled()) {
    return <MachineInviteWebScreen token={token} />
  }
  if (!authenticated) {
    return <Redirect href={{
      pathname: '/(auth)/login',
      params: { redirect: `/machine-invites/${encodeURIComponent(token)}` },
    }} />
  }
  return <MachineInviteAcceptanceScreen token={token} />
}
