// @arch docs/architecture/app/chat-composer-keyboard.md
// @test packages/app/src/__tests__/chat-composer-newline.test.ts

export function insertPlainComposerNewline(
  value: string,
  selectionStart: number,
  selectionEnd: number,
): { value: string; cursor: number } {
  const start = Math.max(0, Math.min(selectionStart, value.length))
  const end = Math.max(start, Math.min(selectionEnd, value.length))
  const nextValue = `${value.slice(0, start)}\n${value.slice(end)}`
  return { value: nextValue, cursor: start + 1 }
}
