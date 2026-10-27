// @arch docs/features/desktop-local-first-client.md#33-进程职责
// @test ../../__tests__/desktop-machine-upgrade.test.ts

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMachinesStore } from '@shennian/shared'
import { useAuthStore } from '../../config/auth'
import type { Machine } from '@shennian/wire'
import { compareVersions, type VersionChangeType } from '../machines/utils/launch'
import { fetchDesktopCliVersion } from './desktopCliVersion'
import { desktopMachinePort } from './desktopMachinePort'

import { upgradeProgressIndex } from '../machines/utils/upgradeProgress'

type UpgradeStartPayload = {
  alreadyLatest?: boolean
  version?: string
  from?: string
  to?: string
}

export type UpgradeStep =
  | { step: 'checking' }
  | { step: 'ready'; latest: string; changeType: VersionChangeType }
  | { step: 'upToDate' }
  | { step: 'upgrading'; latest: string }
  | { step: 'success'; from: string; to: string }
  | { step: 'failed'; error: string; rolledBack?: boolean }

export function useDesktopMachineUpgrade(machine: Machine) {
  const { t } = useTranslation()
  const [step, setStep] = useState<UpgradeStep>({ step: 'checking' })
  const upgradeStates = useMachinesStore((store) => store.upgradeStates)
  const upgradeState = upgradeStates[machine.id]
  const liveMachine = machine
  const accountId = useAuthStore(state => state.user?.id)
  const scope = useMemo(() => ({ active: false, generation: 0 }), [accountId, machine.id])
  const current = useCallback(() => scope.active && useAuthStore.getState().user?.id === accountId, [scope, accountId])
  const originalVersionRef = useRef(machine.cliVersion)
  const operationActiveRef = useRef(false)
  const checkGenerationRef = useRef(0)

  useEffect(() => {
    scope.active = true
    void desktopMachinePort.observe(machine.id).catch(() => {
      if (current()) setStep({ step: 'failed', error: t('machine_upgrade_check_failed') })
    })
    return () => {
      scope.active = false; scope.generation++
      void desktopMachinePort.unobserve(machine.id).catch(() => {})
    }
  }, [scope, current, machine.id, t])

  useEffect(() => {
    if (!current() || !upgradeState) return
    operationActiveRef.current = true
    checkGenerationRef.current += 1

    if ((upgradeState.state === 'success' || upgradeState.state === 'healthy') && upgradeState.to) {
      setStep({ step: 'success', from: upgradeState.from ?? originalVersionRef.current ?? '', to: upgradeState.to })
      return
    }

    if (upgradeState.state === 'failed') {
      setStep({ step: 'failed', error: upgradeState.error ?? t('machine_upgrade_unknown_error') })
      return
    }

    if (upgradeState.state === 'rolledback' || upgradeState.state === 'rolled_back') {
      setStep({ step: 'failed', error: upgradeState.reason ?? t('machine_upgrade_failed'), rolledBack: true })
      return
    }

    if (upgradeState.state === 'interrupted_by_upgrade') {
      setStep({ step: 'failed', error: t('machine_upgrade_tasks_interrupted') })
      return
    }
    if (upgradeState.state === 'recovery_failed') {
      setStep({ step: 'failed', error: upgradeState.error ?? t('machine_upgrade_recovery_failed') })
      return
    }

    if (['restarting', 'starting', 'recovering', 'installing', 'downloading', 'waiting_for_daemon', 'verifying'].includes(upgradeState.state)) {
      setStep((previousStep) => {
        if (previousStep.step === 'upgrading') return previousStep
        return { step: 'upgrading', latest: upgradeState.version ?? upgradeState.to ?? '' }
      })
    }
  }, [t, upgradeState, current])

  useEffect(() => {
    if (!current() || upgradeState?.state !== 'restarting') return

    const timer = setTimeout(() => {
      if (!current()) return
      setStep((previousStep) => {
        if (previousStep.step !== 'upgrading') return previousStep
        return { step: 'failed', error: t('machine_upgrade_restart_timeout') }
      })
    }, 10 * 60_000)

    return () => clearTimeout(timer)
  }, [t, upgradeState?.state, current])

  const checkUpdate = useCallback(async () => {
    if (!current()) return
    operationActiveRef.current = false
    const generation = ++checkGenerationRef.current
    const lifetimeGeneration = ++scope.generation
    setStep({ step: 'checking' })

    try {
      const latest = await fetchDesktopCliVersion()
      if (!current() || lifetimeGeneration !== scope.generation || generation !== checkGenerationRef.current || operationActiveRef.current) return
      const version = machine.cliVersion ?? originalVersionRef.current
      const changeType = compareVersions(version ?? '0.0.0', latest)
      setStep(changeType === 'none' ? { step: 'upToDate' } : { step: 'ready', latest, changeType })
    } catch {
      if (!current() || lifetimeGeneration !== scope.generation || generation !== checkGenerationRef.current || operationActiveRef.current) return
      setStep({ step: 'failed', error: t('machine_upgrade_check_failed') })
    }
  }, [machine.id, machine.cliVersion, t, current, scope])

  useEffect(() => {
    if (!operationActiveRef.current) void checkUpdate()
    return () => { checkGenerationRef.current += 1 }
  }, [checkUpdate])

  const handleUpgrade = useCallback(async (confirmedMajorVersion: string | null = null) => {
    if (!current() || step.step !== 'ready' || operationActiveRef.current) return
    if (!liveMachine?.online) {
      setStep({ step: 'failed', error: t('machine_upgrade_machine_offline') })
      return
    }

    const generation = ++scope.generation
    operationActiveRef.current = true
    checkGenerationRef.current += 1
    originalVersionRef.current = liveMachine.cliVersion ?? machine.cliVersion
    setStep({ step: 'checking' })

    try {
      const latest = await fetchDesktopCliVersion()
      if (!current() || generation !== scope.generation) return
      const changeType = compareVersions(liveMachine?.cliVersion ?? machine.cliVersion ?? '0.0.0', latest)
      if (changeType === 'none') {
        setStep({ step: 'upToDate' })
        return
      }
      if (changeType === 'major' && confirmedMajorVersion !== latest) {
        operationActiveRef.current = false
        setStep({ step: 'ready', latest, changeType })
        return
      }

      setStep({ step: 'upgrading', latest })
      const response = await desktopMachinePort.startUpgrade(
        machine.id,
        latest,
        confirmedMajorVersion === latest,
      )
      if (!current() || generation !== scope.generation) return
      if (!response.ok) {
        setStep({ step: 'failed', error: response.error ?? t('machine_upgrade_request_failed') })
        return
      }
      const payload = response.payload as UpgradeStartPayload | undefined
      if (response.ok && payload?.alreadyLatest) {
        setStep({ step: 'upToDate' })
      }
    } catch (err) {
      if (!current() || generation !== scope.generation) return
      setStep({ step: 'failed', error: err instanceof Error ? err.message : String(err) })
    }
  }, [liveMachine?.cliVersion, liveMachine?.online, machine.cliVersion, machine.id, step, t, current, scope])

  const progressSteps = useMemo(
    () => [
      { key: 'downloading', label: step.step === 'upgrading' && upgradeState?.state === 'restarting'
        ? t('machine_upgrade_handoff_waiting')
        : t('machine_upgrade_downloading', { version: step.step === 'upgrading' ? step.latest : step.step === 'success' ? step.to : '' }) },
      { key: 'installing', label: t('machine_upgrade_installing') },
      { key: 'starting', label: t('machine_upgrade_starting') },
      { key: 'recovering', label: t('machine_upgrade_recovering') },
    ],
    [step, t, upgradeState?.state],
  )

  return {
    checkUpdate,
    currentProgressStepIndex: upgradeProgressIndex(upgradeState?.state),
    handleUpgrade,
    progressSteps,
    step,
  }
}
