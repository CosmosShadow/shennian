import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export function readChatScreenSource(): string {
  return [
    '../features/chat/screens/ChatScreen.tsx',
    '../features/chat/hooks/useChatSessionContext.ts',
  ]
    .map((relativePath) => readFileSync(resolve(__dirname, relativePath), 'utf8'))
    .join('\n')
}
