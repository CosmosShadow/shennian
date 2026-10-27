// @arch docs/features/network-rooms/ui.md#七群聊详情
// @test ../../__tests__/desktop-room-clipboard.test.ts

import * as Clipboard from 'expo-clipboard'

type DesktopClipboardWindow = typeof globalThis & {
  shennianDesktop?: {
    clipboard?: {
      writeText?(text: string): Promise<boolean>
    }
  }
}

export async function copyDesktopRoomInvitation(text: string): Promise<boolean> {
  const desktopClipboard = (globalThis as DesktopClipboardWindow).shennianDesktop?.clipboard
  if (desktopClipboard?.writeText) {
    try {
      return await desktopClipboard.writeText(text)
    } catch {
      return false
    }
  }

  try {
    return await Clipboard.setStringAsync(text)
  } catch {
    return false
  }
}
