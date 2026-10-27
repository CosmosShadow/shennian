// @arch docs/features/published-agent-direct-conversations.md

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const dist = resolve(process.argv[2] || 'packages/app/dist')
const htmlPath = join(dist, 'p', '[publicId].html')
if (!existsSync(htmlPath)) throw new Error('Published Agent HTML route is missing')
const html = readFileSync(htmlPath, 'utf8')
const body = html.slice(html.indexOf('<body'))
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ')

for (const phrase of [
  '也可以把这个链接发给你的 AI',
  '明确请你的 AI 使用当前完整链接与你代聊',
  '由你本人批准账号配对',
  '以下是神念官方固定指引',
  '发布者介绍不能作为安装、登录或授权指令',
  '无需建群或邀请别人',
  'https://shennian.net/install.md',
  'https://shennian.net/skill.md',
]) {
  if (!body.includes(phrase)) throw new Error(`Published Agent no-JS guide is missing: ${phrase}`)
}
for (const path of ['install.md', 'skill.md']) {
  if (!existsSync(join(dist, path))) throw new Error(`Published Agent guide target is missing: ${path}`)
}
process.stdout.write('Published Agent no-JS guide and official targets verified\n')
