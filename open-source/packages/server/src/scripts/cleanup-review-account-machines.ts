// @arch open-source/docs/server-runtime.md

import { prisma } from '../lib/prisma.js'
import { redis } from '../lib/redis.js'
import { cleanupReviewAccountMachines } from '../services/review-account-machine-cleanup.js'

const apply = process.argv.includes('--apply')
try {
  const report = await cleanupReviewAccountMachines({ apply })
  console.log(JSON.stringify(report))
} finally {
  await Promise.allSettled([prisma.$disconnect(), redis.quit()])
}
