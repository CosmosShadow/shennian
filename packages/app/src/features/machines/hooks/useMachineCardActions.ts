// @arch docs/architecture/app/modular-features.md#机器-feature
// @test src/__tests__/machine-feature-utils.test.ts

import { useCallback, useRef, useState } from 'react'
import { TextInput } from 'react-native'
import { useMachinesStore } from '@shennian/shared'
import type { Machine } from '@shennian/wire'
import { isMachineOwner } from '../utils/machineAccessPolicy'
import { machineAccountClient } from '../machineAccountClient'

type Translate = (key: string) => string

export type MachineCardActions = {
  actionsOpen: boolean
  cancelEdit: () => void
  confirmRename: () => Promise<void>
  confirmingUnbind: boolean
  editing: boolean
  handleUnbindConfirm: () => Promise<void>
  inputRef: React.RefObject<TextInput | null>
  isOwner: boolean
  nameInput: string
  renameError: string
  saving: boolean
  setActionsOpen: React.Dispatch<React.SetStateAction<boolean>>
  setConfirmingUnbind: React.Dispatch<React.SetStateAction<boolean>>
  setNameInput: React.Dispatch<React.SetStateAction<string>>
  startEdit: () => void
  unbindError: string
  unbinding: boolean
}

export function useMachineCardActions(machine: Machine, t: Translate): MachineCardActions {
  const renameMachine = useMachinesStore((store) => store.renameMachine)
  const removeMachine = useMachinesStore((store) => store.removeMachine)
  const [editing, setEditing] = useState(false)
  const [nameInput, setNameInput] = useState(machine.name)
  const [saving, setSaving] = useState(false)
  const [unbinding, setUnbinding] = useState(false)
  const [confirmingUnbind, setConfirmingUnbind] = useState(false)
  const [renameError, setRenameError] = useState('')
  const [unbindError, setUnbindError] = useState('')
  const [actionsOpen, setActionsOpen] = useState(false)
  const inputRef = useRef<TextInput>(null)
  const isOwner = isMachineOwner(machine)

  const startEdit = useCallback(() => {
    setActionsOpen(false)
    setNameInput(machine.name)
    setRenameError('')
    setEditing(true)
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [machine.name])

  const cancelEdit = useCallback(() => {
    setEditing(false)
    setRenameError('')
  }, [])

  const confirmRename = useCallback(async () => {
    const trimmed = nameInput.trim()
    if (!trimmed || trimmed === machine.name) {
      setEditing(false)
      return
    }

    setSaving(true)
    setRenameError('')

    try {
      await machineAccountClient.updateMachine(machine.id, trimmed)
      renameMachine(machine.id, trimmed)
      setEditing(false)
    } catch {
      setRenameError(t('rename_failed'))
    } finally {
      setSaving(false)
    }
  }, [machine.id, machine.name, nameInput, renameMachine, t])

  const handleUnbindConfirm = useCallback(async () => {
    setUnbinding(true)
    setUnbindError('')

    try {
      await machineAccountClient.removeMachine(machine.id)
      removeMachine(machine.id)
    } catch {
      setUnbindError(t('unbind_machine_failed'))
      setConfirmingUnbind(false)
    } finally {
      setUnbinding(false)
    }
  }, [machine.id, removeMachine, t])

  return {
    actionsOpen,
    cancelEdit,
    confirmRename,
    confirmingUnbind,
    editing,
    handleUnbindConfirm,
    inputRef,
    isOwner,
    nameInput,
    renameError,
    saving,
    setActionsOpen,
    setConfirmingUnbind,
    setNameInput,
    startEdit,
    unbindError,
    unbinding,
  }
}
