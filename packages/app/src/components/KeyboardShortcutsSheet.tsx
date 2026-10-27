// @arch docs/architecture/app/chat-attachments-preview.md
// @test packages/app/src/__tests__/keyboard-shortcuts.test.ts

import { StyleSheet, Text, View } from 'react-native'
import BottomSheet from './BottomSheet'
import { useTheme } from '../hooks/useTheme'

type Props = {
  visible: boolean
  onClose: () => void
}

const SHORTCUTS = [
  ['Esc', '返回 / 关闭当前预览、详情、弹窗或抽屉'],
  ['⌘/Ctrl + Enter', '发送消息（不改变普通 Enter 换行）'],
  ['⌘/Ctrl + K', '快速打开会话 / 机器 / 项目入口'],
  ['⌘/Ctrl + /', '打开快捷键说明'],
  ['J / K 或 ↑ / ↓', '在会话列表或文件列表中上下移动'],
  ['⌘/Ctrl + R', '刷新当前会话 / 同步'],
  ['⌘/Ctrl + Shift + C', '复制选中文本；无选中文本时复制当前最新消息'],
]

export function KeyboardShortcutsSheet({ visible, onClose }: Props) {
  const { colors } = useTheme()

  return (
    <BottomSheet isOpen={visible} onClose={onClose} title="快捷键" preferDialogOnWeb>
      <View style={styles.list}>
        {SHORTCUTS.map(([key, desc]) => (
          <View key={key} style={[styles.row, { borderColor: colors.border, backgroundColor: colors.surface }]}> 
            <Text style={[styles.key, { color: colors.text }]}>{key}</Text>
            <Text style={[styles.desc, { color: colors.textSecondary }]}>{desc}</Text>
          </View>
        ))}
      </View>
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  list: {
    gap: 10,
  },
  row: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 6,
  },
  key: {
    fontSize: 14,
    fontWeight: '700',
  },
  desc: {
    fontSize: 13,
    lineHeight: 18,
  },
})
