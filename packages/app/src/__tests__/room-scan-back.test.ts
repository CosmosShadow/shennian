// @covers packages/app/app/(main)/scan.tsx
// @covers packages/app/app/(main)/room-join.tsx
// @covers packages/app/src/features/rooms/RoomWorkspaceScreen.tsx
// @covers packages/app/src/features/rooms/NativeRoomInviteScreen.tsx
// @covers packages/app/src/hooks/useGoBack.ts

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CommonActions, StackActions, StackRouter } from '@react-navigation/routers'
import { describe, expect, it, vi } from 'vitest'

const router = vi.hoisted(() => ({ canGoBack: vi.fn(), back: vi.fn(), replace: vi.fn() }))
vi.mock('expo-router', () => ({ useRouter: () => router }))
vi.mock('react', () => ({ useCallback: (callback: unknown) => callback }))
import { useGoBack } from '../hooks/useGoBack'

const read = (path: string) => readFileSync(resolve(__dirname, path), 'utf8')

describe('scanned Room invitation back navigation', () => {
  it('keeps scan, join and conversation inside the same main stack', () => {
    const scan = read('../../app/(main)/scan.tsx')
    expect(scan).toContain("pathname: '/(main)/room-join'")
    expect(scan).not.toContain('router.replace(`/spaces/')
    const joinRoute = read('../../app/(main)/room-join.tsx')
    expect(joinRoute).toContain('<NativeRoomInviteScreen roomId={roomId} inviteToken={invite} />')
    const invite = read('../features/rooms/NativeRoomInviteScreen.tsx')
    expect(invite).toContain("router.replace({ pathname: '/(main)/room-workspace'")
  })

  it.each(['spaces', 'profile'])('returns to %s after replacing scanner and invitation', (origin) => {
    const stack = StackRouter({ initialRouteName: origin })
    const options = {
      routeNames: ['spaces', 'profile', 'scan', 'room-join', 'room-workspace'],
      routeParamList: {},
      routeGetIdList: {},
    }
    let state = stack.getInitialState(options)
    for (const action of [
      CommonActions.navigate('scan'),
      StackActions.replace('room-join', { roomId: 'room_test', invite: 'test-invite' }),
      StackActions.replace('room-workspace', { roomId: 'room_test' }),
    ]) {
      state = stack.getRehydratedState(stack.getStateForAction(state, action, options)!, options)
    }
    expect(state.routes.map((route) => route.name)).toEqual([origin, 'room-workspace'])
    state = stack.getRehydratedState(
      stack.getStateForAction(state, CommonActions.goBack(), options)!, options,
    )
    expect(state.routes.map((route) => route.name)).toEqual([origin])
  })

  it('returns to the Room list when a deep link has no navigation history', () => {
    vi.clearAllMocks()
    router.canGoBack.mockReturnValue(false)
    useGoBack('/(main)/spaces')()
    expect(router.replace).toHaveBeenCalledWith('/(main)/spaces')
    expect(router.back).not.toHaveBeenCalled()
  })

  it('preserves ordinary back navigation and the default fallback for other pages', () => {
    vi.clearAllMocks()
    router.canGoBack.mockReturnValue(true)
    useGoBack('/(main)/spaces')()
    expect(router.back).toHaveBeenCalledOnce()
    expect(router.replace).not.toHaveBeenCalled()
    router.canGoBack.mockReturnValue(false)
    useGoBack()()
    expect(router.replace).toHaveBeenCalledWith('/(main)')
  })

  it('wires both the header and unavailable state to the safe back action', () => {
    const workspace = read('../features/rooms/RoomWorkspaceScreen.tsx')
    expect(workspace).toContain("useGoBack('/(main)/spaces')")
    expect(workspace).toContain('testID="room-workspace-back" onPress={goBack}')
    expect(workspace).toContain('onBack={goBack}')
    const invite = read('../features/rooms/NativeRoomInviteScreen.tsx')
    expect(invite).toContain("useGoBack('/(main)/spaces')")
    expect(invite).toContain('onPress={goBack}')
  })
})
