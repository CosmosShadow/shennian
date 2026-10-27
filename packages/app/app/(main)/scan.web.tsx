// @arch docs/features/desktop-local-first-client.md#33-进程职责
// @test ../../src/__tests__/desktop-authenticated-request-boundary.test.ts
import { Redirect } from 'expo-router'

/** QR scanning is a mobile capability. Desktop pairing uses the fixed main-process machine flow. */
export default function DesktopScanRetiredRoute() {
  return <Redirect href="/(main)/machines" />
}
