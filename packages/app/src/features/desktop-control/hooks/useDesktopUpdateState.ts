// @arch docs/architecture/desktop/unified-desktop.md
// @test packages/app/src/__tests__/desktop-update-ui.test.ts

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getDesktopControlAvailability } from '../bridge'
import type { DesktopBridge, DesktopBridgeResult, DesktopUpdateState } from '../types'

export type DesktopUpdateOperation = 'check' | 'download' | 'install-now' | 'install-on-quit'

type UseDesktopUpdateStateResult = {
  available: boolean
  bridge: DesktopBridge | null
  appVersion: string | null
  operation: DesktopUpdateOperation | null
  retryOperation: 'check' | 'download'
  state: DesktopUpdateState | null
  check: () => Promise<DesktopUpdateState | null>
  download: () => Promise<DesktopUpdateState | null>
  restart: () => Promise<DesktopUpdateState | null>
  installOnExit: () => Promise<DesktopUpdateState | null>
}

function updateLoadError(error: unknown): DesktopUpdateState {
  return {
    status: 'error',
    currentVersion: 'unknown',
    message: error instanceof Error ? error.message : String(error),
  }
}

function unwrapDesktopUpdateResult<T>(result: DesktopBridgeResult<T>): T {
  if (result.ok) return result.value
  throw new Error(result.error.message)
}

export function useDesktopUpdateState(): UseDesktopUpdateStateResult {
  const availability = useMemo(() => getDesktopControlAvailability(), [])
  const [state, setState] = useState<DesktopUpdateState | null>(null)
  const [appVersion, setAppVersion] = useState<string | null>(null)
  const [operation, setOperation] = useState<DesktopUpdateOperation | null>(null)
  const [retryOperation, setRetryOperation] = useState<'check' | 'download'>('check')
  const operationRef = useRef<DesktopUpdateOperation | null>(null)
  const updates = availability.bridge?.updates

  const run = useCallback(
    async <T>(
      nextOperation: DesktopUpdateOperation,
      action: () => Promise<DesktopBridgeResult<T>>,
    ): Promise<T | null> => {
      if (operationRef.current) return null
      operationRef.current = nextOperation
      setOperation(nextOperation)
      try {
        const value = unwrapDesktopUpdateResult(await action())
        if (nextOperation === 'check' || nextOperation === 'download') {
          setRetryOperation(nextOperation)
        }
        return value
      } catch (error) {
        if (nextOperation === 'check' || nextOperation === 'download') {
          setRetryOperation(nextOperation)
        }
        setState(updateLoadError(error))
        throw error
      } finally {
        operationRef.current = null
        setOperation(null)
      }
    },
    [],
  )

  useEffect(() => {
    const unsubscribe = updates?.subscribe((event) => {
      const nextState = event.value
      setState(nextState)
      setAppVersion(nextState.currentVersion)
    })
    return () => unsubscribe?.()
  }, [updates])

  useEffect(() => {
    let canceled = false
    updates
      ?.getState()
      .then((result) => {
        if (canceled) return
        const nextState = unwrapDesktopUpdateResult(result)
        setState(nextState)
        setAppVersion(nextState.currentVersion)
      })
      .catch((error: unknown) => {
        if (!canceled) setState(updateLoadError(error))
      })
    return () => {
      canceled = true
    }
  }, [updates])

  const check = useCallback(async () => {
    if (!updates) return null
    const nextState = await run('check', updates.check)
    if (nextState) {
      setState(nextState)
      setAppVersion(nextState.currentVersion)
    }
    return nextState
  }, [run, updates])

  const download = useCallback(async () => {
    if (!updates) return null
    const nextState = await run('download', updates.download)
    if (nextState) {
      setState(nextState)
      setAppVersion(nextState.currentVersion)
    }
    return nextState
  }, [run, updates])

  const restart = useCallback(async () => {
    if (!updates) return null
    await run('install-now', updates.installNow)
    return state
  }, [run, state, updates])

  const installOnExit = useCallback(async () => {
    if (!updates) return null
    const nextState = await run('install-on-quit', async () => {
      const scheduled = await updates.installOnQuit()
      if (!scheduled.ok) return scheduled
      return updates.getState()
    })
    if (nextState) setState(nextState)
    return nextState
  }, [run, updates])

  return {
    available: availability.available && Boolean(updates),
    bridge: availability.bridge,
    appVersion,
    operation,
    retryOperation,
    state,
    check,
    download,
    restart,
    installOnExit,
  }
}
