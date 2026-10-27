// @covers packages/app/app/(main)/plaza/[publicId].tsx
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(__dirname, '../../app/(main)/plaza/[publicId].tsx'), 'utf8')

describe('plaza AI detail presentation', () => {
  it('uses the AI name as the page title and labels its identity', () => {
    expect(source).toContain("title={agent?.displayName ?? t('mobile_ai_detail')}")
    expect(source).toContain('>{agent.displayName}</Text>')
    expect(source).toContain('>AI</Text>')
  })

  it('keeps save available before adding, without showing a disabled saved button or the detail footnote', () => {
    expect(source).toContain('!saved && agent.allowNewContacts')
    expect(source).toContain("t('mobile_save_contact')")
    expect(source).toContain("'申请添加'")
    expect(source).not.toContain('mobile_contact_saved')
    expect(source).not.toContain('mobile_ai_owner_notice')
  })
})
