import { create } from 'zustand'
import type { AgentType } from '@shennian/wire'

export type PendingAttachment = {
  name: string
  path: string
  mimeType: string
  size: number
}

export type AttachContext = {
  machineId: string
  workDir: string
}

export type PickedFile = {
  uri: string
  name: string
  mimeType: string
  size: number
}

export type ProjectLaunchContext = {
  machineId: string
  workDir: string
  machineName?: string | null
  projectName?: string | null
  preferredAgentType?: AgentType | null
  preferredModelId?: string | null
}

type SheetsState = {
  machinePickerOpen: boolean
  addMachineOpen: boolean
  attachOpen: boolean
  projectLaunchOpen: boolean
  fileDrawerOpen: boolean
  fileRefPickerOpen: boolean
  attachContext: AttachContext | null
  projectLaunchContext: ProjectLaunchContext | null
  pendingAttachments: PendingAttachment[]
  onAttachFilesPicked: ((files: PickedFile[]) => void) | null
  openMachinePicker(): void
  closeMachinePicker(): void
  openAddMachine(): void
  closeAddMachine(): void
  openAttach(context: AttachContext, onFilesPicked?: (files: PickedFile[]) => void): void
  closeAttach(): void
  openProjectLaunch(context: ProjectLaunchContext): void
  closeProjectLaunch(): void
  openFileDrawer(): void
  closeFileDrawer(): void
  openFileRefPicker(): void
  closeFileRefPicker(): void
  setPendingAttachments(files: PendingAttachment[]): void
  clearPendingAttachments(): void
}

export const useSheetsStore = create<SheetsState>((set) => ({
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
  openMachinePicker() { set({ machinePickerOpen: true }) },
  closeMachinePicker() { set({ machinePickerOpen: false }) },
  openAddMachine() { set({ addMachineOpen: true }) },
  closeAddMachine() { set({ addMachineOpen: false }) },
  openAttach(context, onFilesPicked) { set({ attachOpen: true, attachContext: context, onAttachFilesPicked: onFilesPicked ?? null }) },
  closeAttach() { set({ attachOpen: false, onAttachFilesPicked: null }) },
  openProjectLaunch(context) { set({ projectLaunchOpen: true, projectLaunchContext: context }) },
  closeProjectLaunch() { set({ projectLaunchOpen: false, projectLaunchContext: null }) },
  openFileDrawer() { set({ fileDrawerOpen: true }) },
  closeFileDrawer() { set({ fileDrawerOpen: false }) },
  openFileRefPicker() { set({ fileRefPickerOpen: true }) },
  closeFileRefPicker() { set({ fileRefPickerOpen: false }) },
  setPendingAttachments(files) { set({ pendingAttachments: files }) },
  clearPendingAttachments() { set({ pendingAttachments: [] }) },
}))
