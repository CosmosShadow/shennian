// @arch docs/features/network-rooms/ui.md#45-消息正文
// @test src/__tests__/simple-message-markdown.test.ts
import { diaryLinkDate } from '../../features/personal-workspace/diaryLink'
import { useMemo } from 'react'
import { Platform, StyleSheet, Text, type TextStyle } from 'react-native'
import Markdown, { MarkdownIt, type RenderRules } from 'react-native-markdown-display'
import { isLocalMessageLink, isOpenableMessageLink, openMessageLink } from './simpleMessageLinks'
import { roomMessageTextWrapStyle } from '../../features/rooms/roomMessageTextWrap'

export { isOpenableMessageLink } from './simpleMessageLinks'

// Room attachments have their own authenticated UI. Never fetch arbitrary Markdown images.
const rules: RenderRules = {
  image: (node) => <Text key={node.key}>{node.content || '图片'}</Text>,
}

type Props = {
  content: string
  color: string
  linkColor: string
  codeBackground: string
  typography: TextStyle
  onResourcePress?: (path: string) => void
}

export function SimpleMessageMarkdown({ content, color, linkColor, codeBackground, typography, onResourcePress }: Props) {
  const markdown = useMemo(() => {
    const parser = MarkdownIt({ typographer: true, linkify: true, breaks: true })
    // file:// is normally rejected by MarkdownIt. Only personal conversations
    // with an authenticated resource handler may turn it into a preview link.
    parser.validateLink = (url: string) => isOpenableMessageLink(url)
      || (!!onResourcePress && (isLocalMessageLink(url) || !!diaryLinkDate(url)))
    return parser
  }, [onResourcePress])
  const handleLinkPress = (url: string) => openMessageLink(url, onResourcePress)
  const styles = useMemo(() => StyleSheet.create({
    body: { minWidth: 0, maxWidth: '100%' },
    // A text node inside a link inherits the link's colour. An explicit base
    // colour here overrides the parent's link colour in React Native/Web.
    text: { ...roomMessageTextWrapStyle, ...typography },
    textgroup: { ...roomMessageTextWrapStyle, ...typography, color },
    paragraph: { marginTop: 0, marginBottom: 0, flexWrap: 'wrap' },
    link: { color: linkColor, textDecorationLine: 'underline' },
    // The library's inline-code border and 10px padding make short snippets look
    // like input fields. On Web, a snippet alone on a line can fill that whole row.
    code_inline: { ...roomMessageTextWrapStyle, color,
      backgroundColor: Platform.OS === 'web' ? 'transparent' : codeBackground,
      borderWidth: 0, padding: 0,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
    fence: { ...roomMessageTextWrapStyle, color, backgroundColor: codeBackground,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  }), [color, linkColor, codeBackground, typography])

  return <Markdown markdownit={markdown} rules={rules} onLinkPress={handleLinkPress} style={styles}>{content}</Markdown>
}
