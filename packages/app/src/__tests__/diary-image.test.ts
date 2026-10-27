// @covers packages/app/src/features/personal-workspace/diaryImageSource.ts
// @covers packages/app/src/features/personal-workspace/DiaryImage.tsx
import { expect, it } from 'vitest'
import { diaryImageAttachment } from '../features/personal-workspace/diaryImageSource'
it('resolves diary photos relative to the markdown file on the primary computer', () => {
  expect(diaryImageAttachment('../photos/a.png', '/diary', '2026/2026-10-24.md')?.path).toBe('/diary/photos/a.png')
  expect(diaryImageAttachment('/photos/b.jpg', undefined, '2026/a.md')?.path).toBe('/photos/b.jpg')
  expect(diaryImageAttachment('images/a.png', 'C:\\diary', '2026/a.md')?.path).toBe('C:\\diary\\2026\\images\\a.png')
})
it('never loads remote tracking images, non-image files, or guesses missing relative roots', () => {
  for (const src of ['https://example.org/a.png', 'data:image/png;base64,AA', '../secrets.txt']) expect(diaryImageAttachment(src, '/diary', '2026/a.md')).toBeNull()
  expect(diaryImageAttachment('a.png', undefined, '2026/a.md')).toBeNull()
})
