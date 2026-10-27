// @arch docs/design/desktop/macos-interaction-baseline.md
import { useState } from 'react'
import { DesktopRoomRenameDialog } from './DesktopRoomManagementDialogs'
import { desktopRoomManagementClient } from './desktopRoomManagementClient'

export function useDesktopRoomRename(roomId: string, name: string) {
  const [visible, setVisible] = useState(false)
  const [value, setValue] = useState(name)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const open = () => {
    setValue(name)
    setFailed(false)
    setVisible(true)
  }
  const save = async () => {
    if (busy || !value.trim()) return
    setBusy(true)
    setFailed(false)
    try {
      await desktopRoomManagementClient.updateRoom(roomId, { name: value.trim() })
      setVisible(false)
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }
  return {
    open,
    dialog: (
      <DesktopRoomRenameDialog
        visible={visible}
        value={value}
        busy={busy}
        failed={failed}
        onChange={setValue}
        onCancel={() => {
          if (!busy) setVisible(false)
        }}
        onConfirm={() => {
          void save()
        }}
      />
    ),
  }
}
