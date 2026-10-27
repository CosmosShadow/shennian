// @arch open-source/docs/server-runtime.md

import { prisma } from '../lib/prisma.js'
import {
  copyPublishedAiRoomBatch,
  finalizePublishedAiRoom,
} from '../services/published-ai-room-migration.js'
import { setPublishedAiWriteMode } from '../services/published-ai-room-cutover.js'

const actions = ['audit', 'copy', 'pause', 'finalize', 'activate', 'resume-legacy'] as const
type Action = typeof actions[number]
const action = process.argv[2] as Action | undefined
const execute = process.argv.includes('--execute')
if (!action || !actions.includes(action)) {
  throw new Error('Usage: migrate-published-ai-rooms <audit|copy|pause|finalize|activate|resume-legacy> [--execute]')
}
if (action !== 'audit' && !execute) {
  throw new Error('Mutation requires --execute after release-gate approval.')
}

async function forEachDirect(callback: (id: string) => Promise<void>) {
  let cursor: string | undefined
  for (;;) {
    const rows = await prisma.agentDirectConversation.findMany({
      orderBy: { id: 'asc' }, take: 100,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true },
    })
    if (rows.length === 0) return
    for (const row of rows) await callback(row.id)
    cursor = rows.at(-1)!.id
  }
}

try {
  if (action === 'audit') {
    const [control, conversations, ready, inFlight] = await Promise.all([
      prisma.conversationWriteControl.findUnique({ where: { name: 'published_ai' },
        select: { mode: true, everCanonical: true } }),
      prisma.agentDirectConversation.count(),
      prisma.agentDirectConversation.count({ where: { canonicalState: 'ready' } }),
      prisma.agentDirectMessage.count({ where: { status: { in: ['pending', 'running'] } } }),
    ])
    console.log(JSON.stringify({ mode: control?.mode ?? 'missing',
      everCanonical: control?.everCanonical ?? false, conversations, ready, inFlight }))
  } else if (action === 'copy') {
    let conversations = 0
    let messages = 0
    await forEachDirect(async (id) => {
      conversations++
      for (let batch = 0; batch < 1000; batch++) {
        const result = await copyPublishedAiRoomBatch(id)
        messages += result.copied
        if (result.copied === 0) return
      }
      throw new Error('Copy batch limit reached; inspect this conversation before retrying.')
    })
    console.log(JSON.stringify({ action, conversations, messages }))
  } else if (action === 'finalize') {
    let conversations = 0
    await forEachDirect(async (id) => {
      await finalizePublishedAiRoom(id)
      conversations++
    })
    console.log(JSON.stringify({ action, conversations }))
  } else {
    const mode = action === 'pause' ? 'paused'
      : action === 'activate' ? 'canonical' : 'legacy'
    console.log(JSON.stringify({ action, ...await setPublishedAiWriteMode(mode) }))
  }
} finally {
  await prisma.$disconnect()
}
