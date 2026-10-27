// @arch open-source/docs/cli-runtime.md
// @test e2e-relay-result.test.ts

export interface RelayResultInput {
  collectedText: string
  prompt: string
  gotFinal: boolean
  gotError: string
  timedOut: boolean
}

export function evaluateRelayResult(input: RelayResultInput): { passed: boolean; reason: string } {
  if (input.gotError) return { passed: false, reason: input.gotError }
  if (input.timedOut) return { passed: false, reason: 'timed out' }
  if (!input.gotFinal) return { passed: false, reason: 'response did not finish' }

  const answer = input.collectedText
    .split(input.prompt)
    .join('')
    .trim()
    .toLowerCase()

  if (/^hello[.!。！]?$/.test(answer)) return { passed: true, reason: 'ok' }
  return { passed: false, reason: 'response was not the requested exact hello' }
}
