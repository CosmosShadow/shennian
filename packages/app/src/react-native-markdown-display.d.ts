declare module 'react-native-markdown-display' {
  import type { ComponentType, ReactNode } from 'react'
  import type { StyleProp, TextStyle, ViewStyle } from 'react-native'

  export type ASTNode = {
    key: string
    type?: string
    sourceType?: string
    content: string
    children?: ASTNode[]
  }

  export type RenderRules = Record<string, (node: ASTNode, children?: ReactNode[], parent?: ASTNode[], styles?: Record<string, unknown>) => ReactNode>

  export type MarkdownProps = {
    children?: ReactNode
    rules?: RenderRules
    style?: StyleProp<ViewStyle | TextStyle> | Record<string, unknown>
    onLinkPress?: (url: string) => boolean
    markdownit?: {
      validateLink: (url: string) => boolean
      parse: (source: string, env: Record<string, unknown>) => unknown[]
    }
  }

  export function MarkdownIt(options?: Record<string, unknown>): NonNullable<MarkdownProps['markdownit']>
  const Markdown: ComponentType<MarkdownProps>
  export default Markdown
}
