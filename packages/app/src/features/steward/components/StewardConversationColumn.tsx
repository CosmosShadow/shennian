// @arch docs/features/personal-modules.md
import type { ComponentProps, ReactNode } from 'react'
import { ScrollView, View } from 'react-native'
import { StewardMessageList } from './StewardMessageList'
import { StewardMessageRow } from './StewardMessageRow'
export function StewardConversationColumn({
  header,
  content,
  composer,
  menu,
  messagesProps,
}: {
  header?: ReactNode
  content?: ReactNode
  composer: ReactNode
  menu?: ReactNode
  messagesProps: ComponentProps<typeof StewardMessageList>
}) {
  const last = messagesProps.messages[messagesProps.messages.length - 1]
  return (
    <>
      {header}
      <View style={{ flex: 1 }}>{content ?? <StewardMessageList {...messagesProps} />}</View>
      {content && last?.role === 'agent' ? (
        <ScrollView
          style={{ maxHeight: 160 }}
          contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8 }}
        >
          <StewardMessageRow message={last} onResourcePress={messagesProps.onResourcePress} onAttachmentPreviewRequest={messagesProps.onAttachmentPreviewRequest} />
        </ScrollView>
      ) : null}
      {menu}
      {composer}
    </>
  )
}
