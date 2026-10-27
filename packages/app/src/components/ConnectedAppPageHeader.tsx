// @arch docs/features/network-rooms/mobile-control-and-single-room-web.md
// @test src/__tests__/app-page-header.test.ts

import type { ComponentProps } from 'react'
import { AppPageHeader as Header } from './AppPageHeader'
import { useAppConnectivityStatus } from '../hooks/useAppConnectivityStatus'

/** Full-control surfaces opt in; public headers never initialize account connectivity. */
export function AppPageHeader(props: Omit<ComponentProps<typeof Header>, 'connectivityStatus'>) {
  const connectivityStatus = useAppConnectivityStatus()
  return <Header {...props} connectivityStatus={connectivityStatus} />
}

export { HeaderIconButton } from './AppPageHeader'
