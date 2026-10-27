// @arch open-source/docs/server-runtime.md

import { prisma } from '../lib/prisma.js'
import { cleanupRequestLogCredentials } from '../services/request-log-credential-cleanup.js'

const apply = process.argv.includes('--apply')
try {
  const report = await cleanupRequestLogCredentials({ apply })
  console.log(JSON.stringify(report))
} finally {
  await prisma.$disconnect()
}
