// @arch open-source/docs/server-runtime.md

import { cleanupLogFiles } from '../services/log-file-credential-cleanup.js'

const apply = process.argv.includes('--apply')
const files = process.argv
  .filter((argument) => argument.startsWith('--file='))
  .map((argument) => argument.slice('--file='.length))

const report = await cleanupLogFiles(files, { apply })
console.log(JSON.stringify(report))
