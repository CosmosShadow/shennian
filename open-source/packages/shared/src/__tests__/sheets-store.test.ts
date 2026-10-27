// @covers open-source/packages/shared/src/stores/sheets.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSheetsStore, type PickedFile } from '../stores/sheets'

describe('sheets store', () => {
  beforeEach(() => {
    useSheetsStore.setState({
      machinePickerOpen: false,
      addMachineOpen: false,
      attachOpen: false,
      projectLaunchOpen: false,
      fileDrawerOpen: false,
      fileRefPickerOpen: false,
      attachContext: null,
      projectLaunchContext: null,
      pendingAttachments: [],
      onAttachFilesPicked: null,
    })
  })

  it('open/close machine picker toggles only the picker flag', () => {
    useSheetsStore.getState().openMachinePicker()
    expect(useSheetsStore.getState().machinePickerOpen).toBe(true)
    useSheetsStore.getState().closeMachinePicker()
    expect(useSheetsStore.getState().machinePickerOpen).toBe(false)
  })

  it('openAttach stores callback; closeAttach drops callback but keeps context pristine on re-open', () => {
    const cb = vi.fn<(files: PickedFile[]) => void>()
    useSheetsStore
      .getState()
      .openAttach({ machineId: 'm-1', workDir: '/w' }, cb)
    expect(useSheetsStore.getState().attachOpen).toBe(true)
    expect(useSheetsStore.getState().attachContext).toEqual({ machineId: 'm-1', workDir: '/w' })
    expect(useSheetsStore.getState().onAttachFilesPicked).toBe(cb)

    useSheetsStore.getState().closeAttach()
    expect(useSheetsStore.getState().attachOpen).toBe(false)
    expect(useSheetsStore.getState().onAttachFilesPicked).toBeNull()
  })

  it('setPendingAttachments replaces list, clear wipes it', () => {
    useSheetsStore.getState().setPendingAttachments([
      { name: 'a.png', path: '/tmp/a.png', mimeType: 'image/png', size: 10 },
      { name: 'b.pdf', path: '/tmp/b.pdf', mimeType: 'application/pdf', size: 20 },
    ])
    expect(useSheetsStore.getState().pendingAttachments).toHaveLength(2)
    useSheetsStore.getState().clearPendingAttachments()
    expect(useSheetsStore.getState().pendingAttachments).toEqual([])
  })

  it('openProjectLaunch stores context and close clears it', () => {
    useSheetsStore.getState().openProjectLaunch({
      machineId: 'm-1',
      machineName: 'Macbook',
      projectName: 'demo',
      workDir: '/tmp/demo',
      preferredAgentType: 'codex',
      preferredModelId: 'gpt-5.4',
    })

    expect(useSheetsStore.getState()).toMatchObject({
      projectLaunchOpen: true,
      projectLaunchContext: {
        machineId: 'm-1',
        machineName: 'Macbook',
        projectName: 'demo',
        workDir: '/tmp/demo',
        preferredAgentType: 'codex',
        preferredModelId: 'gpt-5.4',
      },
    })

    useSheetsStore.getState().closeProjectLaunch()
    expect(useSheetsStore.getState()).toMatchObject({
      projectLaunchOpen: false,
      projectLaunchContext: null,
    })
  })
})
