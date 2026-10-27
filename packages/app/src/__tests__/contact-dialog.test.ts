// @covers packages/app/src/features/contact/ContactOptions.tsx
// @covers docs/features/contact-and-reviews.md

import { readFileSync } from 'node:fs'
import { URL } from 'node:url'
import { describe, expect, it } from 'vitest'
import ts from 'typescript'

const source = readFileSync(new URL('../features/contact/ContactOptions.tsx', import.meta.url), 'utf8')
const file = ts.createSourceFile('ContactOptions.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const elements: ts.JsxElement[] = []
function visit(node: ts.Node) {
  if (ts.isJsxElement(node)) elements.push(node)
  ts.forEachChild(node, visit)
}
visit(file)

describe('contact dialog dismissal structure', () => {
  it('puts a full-screen close target behind, not around, the dialog content', () => {
    const backdrop = elements.find(node => node.openingElement.getText(file) === '<View style={styles.backdrop}>')!
    expect(backdrop).toBeDefined()
    const children = backdrop.children.filter(node => ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node))
    expect(children).toHaveLength(2)
    expect(ts.isJsxSelfClosingElement(children[0])).toBe(true)
    const dismiss = children[0].getText(file)
    expect(dismiss).toContain('<Pressable')
    expect(dismiss).toContain('style={StyleSheet.absoluteFill}')
    expect(dismiss).toContain('onPress={onClose}')
    expect(dismiss).toContain('accessible={false}')
    expect(dismiss).toContain('tabIndex={-1}')
    expect(children[1].getText(file)).toContain('accessibilityViewIsModal')
    expect(children[1].getText(file)).toContain('<ContactOptions {...options} />')
    expect(backdrop.openingElement.getText(file)).not.toContain('onPress')
  })

  it('preserves explicit close and native back dismissal', () => {
    expect(source).toContain('onRequestClose={onClose}')
    expect(source).toContain('<HeaderIconButton icon="close" label={t(\'close\')} onPress={onClose} />')
    expect(source).toContain("if (Platform.OS !== 'web')")
    expect(source).toContain(
      "presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'}",
    )
  })
})
