import { Animated, Modal } from 'react-native'
import { FilePanel, type SendFn } from '../../../components/chat'
import type {
  FileSelectionAiRequest,
  FileSelectionQuoteRequest,
} from '../../../components/chat/fileSelectionAi'
import type { Colors } from '../../../hooks/useTheme'
import { useEscapeKey } from '../../../hooks/useEscapeKey'
import { styles } from '../screens/ChatScreen.styles'

type ChatFileDrawerHostProps = {
  isMobileDrawer: boolean
  mobileDrawerVisible: boolean
  mobileDrawerProgress: Animated.Value
  width: number
  topInset: number
  bottomInset: number
  colors: Colors
  send: SendFn
  workDir: string
  previewRequest?: {
    id: number
    path: string
    name: string
    kind?: 'folder'
    line?: number
    endLine?: number
  } | null
  onInsertRef: (path: string) => void
  onSelectionAiAction?: (request: FileSelectionAiRequest) => void
  onSelectionQuoteAction?: (request: FileSelectionQuoteRequest) => void
  refreshToken?: number
  onClose: () => void
}

export function ChatFileDrawerHost({
  isMobileDrawer,
  mobileDrawerVisible,
  mobileDrawerProgress,
  width,
  topInset,
  bottomInset,
  colors,
  send,
  workDir,
  previewRequest,
  onInsertRef,
  onSelectionAiAction,
  onSelectionQuoteAction,
  refreshToken,
  onClose,
}: ChatFileDrawerHostProps) {
  useEscapeKey(isMobileDrawer && mobileDrawerVisible, onClose)

  if (!isMobileDrawer || !mobileDrawerVisible) return null

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <Animated.View
        style={[
          styles.mobileDrawerFullscreen,
          {
            paddingTop: topInset,
            paddingBottom: Math.max(bottomInset, 8),
            backgroundColor: colors.bg,
            transform: [
              {
                translateX: mobileDrawerProgress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [width + 24, 0],
                }),
              },
            ],
          },
        ]}
      >
        <FilePanel
          send={send}
          workDir={workDir}
          previewRequest={previewRequest}
          onInsertRef={onInsertRef}
          onSelectionAiAction={onSelectionAiAction}
          onSelectionQuoteAction={onSelectionQuoteAction}
          refreshToken={refreshToken}
          onClose={onClose}
          presentation="fullscreen"
        />
      </Animated.View>
    </Modal>
  )
}
