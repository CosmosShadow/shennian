// @arch open-source/docs/server-runtime.md

import { cleanupRetiredPersonalTranscriptObjects } from '../services/retired-personal-transcript-cleanup.js'

const execute = process.argv.includes('--execute')
const report = await cleanupRetiredPersonalTranscriptObjects({ execute })
console.log(JSON.stringify({ mode: execute ? 'execute' : 'audit', ...report }))
