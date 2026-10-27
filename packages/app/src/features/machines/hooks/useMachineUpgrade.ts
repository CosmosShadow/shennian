// @arch docs/architecture/app/modular-features.md#机器-feature
// @test src/__tests__/machine-feature-utils.test.ts

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMachinesStore } from '@shennian/shared'
import type { Machine } from '@shennian/wire'
import { accountRuntime } from '../../account-runtime/accountRuntime'
import { compareVersions, fetchLatestCliVersion, type VersionChangeType } from '../utils/launch'

import { upgradeProgressIndex } from '../utils/upgradeProgress'

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

export function useMachineUpgrade(machine: Machine) {
  const { t } = useTranslation()
  const [step, setStep] = useState<UpgradeStep>({ step: 'checking' })
  const upgradeStates = useMachinesStore((store) => store.upgradeStates)
  const upgradeState = upgradeStates[machine.id]
  const liveMachine = useMachinesStore((store) => store.machines.find((item) => item.id === machine.id))
  const originalVersionRef = useRef(machine.cliVersion)
  const operationActiveRef = useRef(false)
  const checkGenerationRef = useRef(0)

  useEffect(() => {
    void accountRuntime.observeMachine(machine.id)
    return () => { void accountRuntime.unobserveMachine(machine.id) }
  }, [machine.id])

  useEffect(() => {
    if (!upgradeState) return
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
  }, [t, upgradeState])

  useEffect(() => {
    if (upgradeState?.state !== 'restarting') return

    const timer = setTimeout(() => {
      setStep((previousStep) => {
        if (previousStep.step !== 'upgrading') return previousStep
        return { step: 'failed', error: t('machine_upgrade_restart_timeout') }
      })
    }, 10 * 60_000)

    return () => clearTimeout(timer)
  }, [t, upgradeState?.state])

  const checkUpdate = useCallback(async () => {
    operationActiveRef.current = false
    const generation = ++checkGenerationRef.current
    setStep({ step: 'checking' })

    try {
      const latest = await fetchLatestCliVersion({ force: true })
      if (generation !== checkGenerationRef.current || operationActiveRef.current) return
      const version = useMachinesStore.getState().machines.find(item => item.id === machine.id)?.cliVersion ?? originalVersionRef.current
      const changeType = compareVersions(version ?? '0.0.0', latest)
      setStep(changeType === 'none' ? { step: 'upToDate' } : { step: 'ready', latest, changeType })
    } catch {
      if (generation !== checkGenerationRef.current || operationActiveRef.current) return
      setStep({ step: 'failed', error: t('machine_upgrade_check_failed') })
    }
  }, [machine.id, t])

  useEffect(() => {
    if (!operationActiveRef.current) void checkUpdate()
    return () => { checkGenerationRef.current += 1 }
  }, [checkUpdate])

  const handleUpgrade = useCallback(async (confirmedMajorVersion: string | null = null) => {
    if (step.step !== 'ready') return
    if (!liveMachine?.online) {
      setStep({ step: 'failed', error: t('machine_upgrade_machine_offline') })
      return
    }

    operationActiveRef.current = true
    checkGenerationRef.current += 1
    originalVersionRef.current = liveMachine.cliVersion ?? machine.cliVersion
    setStep({ step: 'checking' })

    try {
      const latest = await fetchLatestCliVersion({ force: true })
      const changeType = compareVersions(liveMachine?.cliVersion ?? machine.cliVersion ?? '0.0.0', latest)
      if (changeType === 'none') {
        useMachinesStore.getState().updateMachineCliVersion(machine.id, latest)
        setStep({ step: 'upToDate' })
        return
      }
      if (changeType === 'major' && confirmedMajorVersion !== latest) {
        setStep({ step: 'ready', latest, changeType })
        return
      }

      setStep({ step: 'upgrading', latest })
      const response = await accountRuntime.requestMachine(
        machine.id,
        'upgrade.start',
        { version: latest, confirmedMajor: confirmedMajorVersion === latest },
      )
      if (!response.ok) {
        setStep({ step: 'failed', error: response.error ?? t('machine_upgrade_request_failed') })
        return
      }
      const payload = response.payload as UpgradeStartPayload | undefined
      if (response.ok && payload?.alreadyLatest) {
        const version = payload.version ?? latest
        useMachinesStore.getState().updateMachineCliVersion(machine.id, version)
        setStep({ step: 'upToDate' })
      }
    } catch (err) {
      setStep({ step: 'failed', error: err instanceof Error ? err.message : String(err) })
    }
  }, [liveMachine?.cliVersion, liveMachine?.online, machine.cliVersion, machine.id, step, t])

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
